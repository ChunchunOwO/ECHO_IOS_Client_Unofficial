import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import {
  Alert,
  GestureResponderEvent,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  createEchoLinkClient,
  EchoLinkHttpError,
  EchoLinkNetworkError,
  normalizeEchoLinkHost,
  normalizeEchoLinkToken,
  type EchoLinkConnection,
} from './src/echoLink/client';
import type { EchoLinkStatusResponse, EchoLinkTrackPreview } from './src/echoLink/types';
import { parsePairingUri } from './src/echoLink/pairing';
import { loadSavedConnection, saveConnection } from './src/storage/connectionStore';

type AppPage = 'control' | 'library' | 'connect';
type PlaybackOutputMode = 'pc' | 'phone';
type PendingPcSeek = {
  positionMs: number;
  requestedAtMs: number;
  trackId: string | null;
};

const formatTime = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const ratioFromGesture = (event: GestureResponderEvent, width: number): number => (
  width > 0 ? clamp01(event.nativeEvent.locationX / width) : 0
);

const formatSourceTag = (sourceLabel: string | null | undefined): string | null => {
  const value = sourceLabel?.trim();
  if (!value) {
    return null;
  }
  if (/local/iu.test(value)) {
    return 'Local';
  }
  if (/remote/iu.test(value)) {
    return 'Remote';
  }
  if (/stream/iu.test(value)) {
    return 'Streaming';
  }
  return value;
};

const formatOutputTag = (outputMode: string | null | undefined): string | null => {
  const value = outputMode?.trim();
  if (!value) {
    return null;
  }
  if (/asio/iu.test(value)) {
    return 'ASIO';
  }
  if (/wasapi|shared|exclusive/iu.test(value)) {
    return 'WASAPI';
  }
  if (/system/iu.test(value)) {
    return 'System';
  }
  return value;
};

const formatCodecTag = (codec: string | null | undefined): string | null => {
  const value = codec?.trim();
  return value ? value.toUpperCase() : null;
};

const formatSampleRateTag = (sampleRate: number | null | undefined): string | null => {
  if (!Number.isFinite(sampleRate) || !sampleRate || sampleRate <= 0) {
    return null;
  }
  const khz = sampleRate / 1000;
  return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)}kHz`;
};

const formatBitDepthTag = (bitDepth: number | null | undefined): string | null => {
  if (!Number.isFinite(bitDepth) || !bitDepth || bitDepth <= 0) {
    return null;
  }
  return `${Math.round(bitDepth)}bit`;
};

const formatBitrateTag = (bitrate: number | null | undefined): string | null => {
  if (!Number.isFinite(bitrate) || !bitrate || bitrate <= 0) {
    return null;
  }
  const kbps = bitrate >= 1000 ? bitrate / 1000 : bitrate;
  return `${Math.round(kbps)}kbps`;
};

const formatQualityTag = (track: EchoLinkTrackPreview | null | undefined): string | null => {
  const sampleRate = formatSampleRateTag(track?.sampleRate);
  const bitDepth = formatBitDepthTag(track?.bitDepth);
  if (sampleRate && bitDepth) {
    return `${sampleRate}/${bitDepth}`;
  }
  return sampleRate ?? bitDepth;
};

const tagsForTrack = (
  track: EchoLinkTrackPreview | null | undefined,
  options: { includeDuration?: boolean; outputMode?: string | null } = {},
): string[] => {
  const tags = [
    formatOutputTag(options.outputMode),
    formatSourceTag(track?.sourceLabel),
    track ? (track.canPlayOnPhone ? '可串流' : '仅控制') : null,
    formatCodecTag(track?.codec),
    formatQualityTag(track),
    formatBitrateTag(track?.bitrate),
    options.includeDuration && track ? formatTime(track.durationMs) : null,
  ];
  return tags.filter((tag): tag is string => Boolean(tag && tag.trim()));
};

const initialConnection: EchoLinkConnection = {
  host: '',
  port: 26789,
  token: '',
  name: 'PC ECHO',
  scheme: 'http',
};

const formatRequestError = (error: unknown): string => {
  if (error instanceof EchoLinkNetworkError) {
    return error.message;
  }
  if (error instanceof EchoLinkHttpError) {
    if (error.statusCode === 401) {
      return '认证失败：Token 不匹配。请在电脑端重新生成配对链接，或重新输入最新 token。';
    }
    if (error.statusCode === 403) {
      return '电脑端拒绝了请求：请确认手机和电脑在同一个局域网，且没有走蜂窝网络、访客 Wi-Fi、VPN 或热点隔离。';
    }
    return `${error.statusCode} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
};

const formatPhoneAudioError = (error: unknown): string => {
  if (error instanceof EchoLinkHttpError && (error.statusCode === 409 || error.statusCode === 415)) {
    return '这首歌暂时不能在手机播放。请先用本地 MP3/AAC/M4A 等 iOS 友好的音频文件测试。';
  }
  return formatRequestError(error);
};

type ErrorBoundaryState = {
  error: Error | null;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ECHO iPhone startup error', error, errorInfo.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>应用启动失败</Text>
            <Text style={styles.errorText}>{this.state.error.message}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
}

function EchoLinkApp(): ReactElement {
  const phonePlayer = useAudioPlayer(null, {
    keepAudioSessionActive: true,
    preferredForwardBufferDuration: 12,
    updateInterval: 250,
  });
  const phonePlayerStatus = useAudioPlayerStatus(phonePlayer);
  const [page, setPage] = useState<AppPage>('control');
  const [connection, setConnection] = useState<EchoLinkConnection>(initialConnection);
  const [pairingText, setPairingText] = useState('');
  const [status, setStatus] = useState<EchoLinkStatusResponse | null>(null);
  const [statusReceivedAtMs, setStatusReceivedAtMs] = useState(() => Date.now());
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [tracks, setTracks] = useState<EchoLinkTrackPreview[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playbackOutputMode, setPlaybackOutputMode] = useState<PlaybackOutputMode>('pc');
  const [phoneTrack, setPhoneTrack] = useState<EchoLinkTrackPreview | null>(null);
  const [phoneAudioBusy, setPhoneAudioBusy] = useState(false);
  const [phoneAudioError, setPhoneAudioError] = useState<string | null>(null);
  const [phoneVolume, setPhoneVolume] = useState(1);
  const [phoneSeekPreviewMs, setPhoneSeekPreviewMs] = useState<number | null>(null);
  const [progressTrackWidth, setProgressTrackWidth] = useState(0);
  const [volumeTrackWidth, setVolumeTrackWidth] = useState(0);
  const statusPollInFlight = useRef(false);
  const sliderInteractionInFlight = useRef(false);
  const latestStatusRef = useRef<EchoLinkStatusResponse | null>(null);
  const pendingPcSeekRef = useRef<PendingPcSeek | null>(null);

  const client = useMemo(() => (
    connection.host.trim() && connection.token.trim()
      ? createEchoLinkClient(connection)
      : null
  ), [connection]);

  const applyStatus = useCallback((nextStatus: EchoLinkStatusResponse, options: { force?: boolean } = {}) => {
    const pendingSeek = pendingPcSeekRef.current;
    if (pendingSeek && !options.force) {
      const nextTrackId = nextStatus.playback.track?.id ?? null;
      const pendingAgeMs = Date.now() - pendingSeek.requestedAtMs;
      const expectedPositionMs = pendingSeek.positionMs + (
        nextStatus.playback.state === 'playing' ? Math.max(0, pendingAgeMs) : 0
      );
      const closeEnough = Math.abs(nextStatus.playback.positionMs - expectedPositionMs) < 1200;

      if (nextTrackId === pendingSeek.trackId && !closeEnough && pendingAgeMs < 3500) {
        return;
      }
      pendingPcSeekRef.current = null;
    }
    latestStatusRef.current = nextStatus;
    setStatus(nextStatus);
    setStatusReceivedAtMs(Date.now());
  }, []);

  const patchPlayback = useCallback((patch: Partial<EchoLinkStatusResponse['playback']>) => {
    const now = Date.now();
    setStatus((current) => {
      if (!current) {
        return current;
      }
      const nextStatus = {
        ...current,
        playback: {
          ...current.playback,
          ...patch,
          updatedAtEpochMs: now,
        },
      };
      latestStatusRef.current = nextStatus;
      return nextStatus;
    });
    setClockMs(now);
    setStatusReceivedAtMs(now);
  }, []);

  const refresh = useCallback(async () => {
    if (!client) {
      return;
    }
    setBusy(true);
    setError(null);
    setLibraryError(null);
    try {
      const nextStatus = await client.getStatus();
      applyStatus(nextStatus);
    } catch (refreshError) {
      setError(formatRequestError(refreshError));
      setBusy(false);
      return;
    }

    try {
      const library = await client.getLibraryTracks({ page: 1, pageSize: 20, query });
      setTracks(library.tracks);
    } catch (libraryLoadError) {
      setLibraryError(`已连接电脑端，但曲库加载失败：${formatRequestError(libraryLoadError)}`);
    } finally {
      setBusy(false);
    }
  }, [applyStatus, client, query]);

  useEffect(() => {
    let mounted = true;
    void loadSavedConnection().then((saved) => {
      if (mounted && saved) {
        setConnection(saved);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (client) {
      void refresh();
    }
  }, [client, refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      setClockMs(Date.now());
    }, 500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    void setAudioModeAsync({
      interruptionMode: 'doNotMix',
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    }).catch((audioModeError) => {
      setPhoneAudioError(formatRequestError(audioModeError));
    });
  }, []);

  useEffect(() => {
    if (!client) {
      return undefined;
    }

    let cancelled = false;
    const pollStatus = async () => {
      if (statusPollInFlight.current) {
        return;
      }
      statusPollInFlight.current = true;
      try {
        const nextStatus = await client.getStatus();
        if (!cancelled && !sliderInteractionInFlight.current) {
          applyStatus(nextStatus);
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled && !latestStatusRef.current) {
          setError(formatRequestError(pollError));
        }
      } finally {
        statusPollInFlight.current = false;
      }
    };

    void pollStatus();
    const interval = setInterval(() => {
      void pollStatus();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [applyStatus, client]);

  const applyPairingText = useCallback(async () => {
    try {
      const parsed = parsePairingUri(pairingText);
      parsed.host = normalizeEchoLinkHost(parsed.host);
      setConnection(parsed);
      await saveConnection(parsed);
      setPairingText('');
      setError(null);
      setPage('control');
    } catch (pairingError) {
      Alert.alert('配对失败', pairingError instanceof Error ? pairingError.message : String(pairingError));
    }
  }, [pairingText]);

  const saveManualConnection = useCallback(async () => {
    const nextConnection = {
      ...connection,
      host: normalizeEchoLinkHost(connection.host),
      token: normalizeEchoLinkToken(connection.token),
      port: Number(connection.port) || 26789,
      scheme: connection.scheme || 'http',
    };
    setConnection(nextConnection);
    await saveConnection(nextConnection);
    setPage('control');
    void refresh();
  }, [connection, refresh]);

  const sendCommand = useCallback(async (command: Parameters<NonNullable<typeof client>['sendPlaybackCommand']>[0]) => {
    if (!client) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      applyStatus(await client.sendPlaybackCommand(command));
    } catch (commandError) {
      setError(formatRequestError(commandError));
    } finally {
      setBusy(false);
    }
  }, [applyStatus, client]);

  const playTrackOnPc = useCallback((track: EchoLinkTrackPreview) => {
    void sendCommand({ command: 'playTrack', trackId: track.id, output: 'pc' });
  }, [sendCommand]);

  const nowPlaying = status?.playback.track;
  const playbackQueue = status?.playback.queue;
  const playlistItems = playbackQueue?.items ?? [];
  const visiblePlaylistItems = playlistItems.slice(0, 8);
  const hiddenPlaylistItemCount = Math.max(0, playlistItems.length - visiblePlaylistItems.length);
  const isPhoneOutput = playbackOutputMode === 'phone';
  const displayTrack = isPhoneOutput ? phoneTrack ?? nowPlaying : nowPlaying;
  const connectedLabel = status ? `已连接 ${status.device.name}` : '尚未连接';
  const pcPlaybackPositionMs = status
    ? Math.max(0, Math.min(
      status.playback.durationMs || Number.MAX_SAFE_INTEGER,
      status.playback.positionMs + (status.playback.state === 'playing' ? Math.max(0, clockMs - statusReceivedAtMs) : 0),
    ))
    : 0;
  const phonePlaybackPositionMs = Math.max(0, Math.round(phonePlayerStatus.currentTime * 1000));
  const playbackPositionMs = isPhoneOutput
    ? phoneSeekPreviewMs ?? phonePlaybackPositionMs
    : pcPlaybackPositionMs;
  const playbackDurationMs = isPhoneOutput
    ? Math.max(0, Math.round(phonePlayerStatus.duration * 1000) || displayTrack?.durationMs || 0)
    : status?.playback.durationMs ?? 0;
  const progressRatio = playbackDurationMs
    ? clamp01(playbackPositionMs / playbackDurationMs)
    : 0;
  const outputVolume = isPhoneOutput ? phoneVolume : status?.playback.volume ?? 0;
  const volumePercent = Math.round(outputVolume * 100);
  const isPlaybackActive = isPhoneOutput ? phonePlayerStatus.playing : status?.playback.state === 'playing';
  const playbackTags = tagsForTrack(displayTrack, {
    outputMode: isPhoneOutput ? '串流' : status?.playback.outputMode,
  });

  const playTrackOnPhone = useCallback(async (
    track: EchoLinkTrackPreview,
    positionMs = 0,
    pausePcAfterStart = false,
  ) => {
    if (!client) {
      return;
    }
    if (!track.canPlayOnPhone) {
      setPhoneAudioError('这首歌暂时不能直接串流到手机。请换一首本地 MP3/AAC/M4A 等 iOS 友好格式的歌曲。');
      return;
    }

    setPhoneAudioBusy(true);
    setPhoneAudioError(null);
    setPhoneSeekPreviewMs(null);
    try {
      const stream = await client.createPhoneStream(track.id);
      const nextVolume = playbackOutputMode === 'phone'
        ? phoneVolume
        : status?.playback.volume ?? phoneVolume;

      phonePlayer.pause();
      phonePlayer.replace({
        name: `${stream.track.title} - ${stream.track.artist}`,
        uri: stream.streamUrl,
      });
      phonePlayer.volume = nextVolume;
      setPhoneVolume(nextVolume);
      setPhoneTrack(stream.track);
      setPlaybackOutputMode('phone');
      phonePlayer.setActiveForLockScreen(true, {
        albumTitle: stream.track.album,
        artist: stream.track.artist,
        artworkUrl: stream.track.artworkUrl ?? undefined,
        title: stream.track.title,
      }, {
        showSeekBackward: true,
        showSeekForward: true,
      });
      if (positionMs > 0) {
        await phonePlayer.seekTo(positionMs / 1000).catch(() => undefined);
      }
      phonePlayer.play();

      if (pausePcAfterStart && (status?.playback.state === 'playing' || status?.playback.state === 'loading')) {
        void client.sendPlaybackCommand({ command: 'playPause' })
          .then(applyStatus)
          .catch((handoffError) => setPhoneAudioError(formatPhoneAudioError(handoffError)));
      }
    } catch (phoneError) {
      setPhoneAudioError(formatPhoneAudioError(phoneError));
    } finally {
      setPhoneAudioBusy(false);
    }
  }, [applyStatus, client, phonePlayer, phoneVolume, playbackOutputMode, status]);

  const switchToPhonePlayback = useCallback(() => {
    if (isPhoneOutput) {
      return;
    }
    const track = nowPlaying ?? phoneTrack;
    if (!track) {
      setPhoneAudioError('当前没有可播放的歌曲。请先在电脑端播放一首歌。');
      return;
    }
    void playTrackOnPhone(track, nowPlaying?.id === track.id ? pcPlaybackPositionMs : 0, true);
  }, [isPhoneOutput, nowPlaying, pcPlaybackPositionMs, phoneTrack, playTrackOnPhone]);

  const switchToPcPlayback = useCallback(() => {
    if (!isPhoneOutput) {
      return;
    }
    const track = phoneTrack ?? nowPlaying;
    const positionMs = Math.max(0, Math.round(phonePlayerStatus.currentTime * 1000));

    phonePlayer.pause();
    phonePlayer.clearLockScreenControls();
    setPlaybackOutputMode('pc');
    setPhoneSeekPreviewMs(null);
    setPhoneAudioError(null);

    if (client && track) {
      void client.sendPlaybackCommand({
        command: 'handoff',
        positionMs,
        target: 'pc',
        trackId: track.id,
      })
        .then(applyStatus)
        .catch((handoffError) => setError(formatRequestError(handoffError)));
    }
  }, [applyStatus, client, isPhoneOutput, nowPlaying, phonePlayer, phonePlayerStatus.currentTime, phoneTrack]);

  const togglePlayPause = useCallback(() => {
    if (isPhoneOutput) {
      if (!phoneTrack) {
        switchToPhonePlayback();
        return;
      }
      if (phonePlayerStatus.playing) {
        phonePlayer.pause();
      } else {
        phonePlayer.play();
      }
      return;
    }
    void sendCommand({ command: 'playPause' });
  }, [isPhoneOutput, phonePlayer, phonePlayerStatus.playing, phoneTrack, sendCommand, switchToPhonePlayback]);

  const playRelativePhoneQueueTrack = useCallback((direction: -1 | 1) => {
    const currentTrackId = phoneTrack?.id ?? nowPlaying?.id ?? playbackQueue?.currentTrackId;
    const currentIndex = playlistItems.findIndex((item) => item.id === currentTrackId);
    const nextTrack = currentIndex >= 0 ? playlistItems[currentIndex + direction] : null;
    if (!nextTrack) {
      setPhoneAudioError(direction > 0 ? '播放列表里暂时没有下一首。' : '播放列表里暂时没有上一首。');
      return;
    }
    void playTrackOnPhone(nextTrack, 0, false);
  }, [nowPlaying, phoneTrack, playbackQueue?.currentTrackId, playlistItems, playTrackOnPhone]);

  const playPrevious = useCallback(() => {
    if (isPhoneOutput) {
      playRelativePhoneQueueTrack(-1);
      return;
    }
    void sendCommand({ command: 'previous' });
  }, [isPhoneOutput, playRelativePhoneQueueTrack, sendCommand]);

  const playNext = useCallback(() => {
    if (isPhoneOutput) {
      playRelativePhoneQueueTrack(1);
      return;
    }
    void sendCommand({ command: 'next' });
  }, [isPhoneOutput, playRelativePhoneQueueTrack, sendCommand]);

  const updateSeekFromGesture = useCallback((event: GestureResponderEvent, commit: boolean) => {
    if ((!status && !isPhoneOutput) || !playbackDurationMs || progressTrackWidth <= 0) {
      return;
    }
    const ratio = ratioFromGesture(event, progressTrackWidth);
    const positionMs = Math.round(playbackDurationMs * ratio);
    if (isPhoneOutput) {
      setPhoneSeekPreviewMs(commit ? null : positionMs);
      if (commit) {
        void phonePlayer.seekTo(positionMs / 1000);
      }
      return;
    }
    sliderInteractionInFlight.current = true;
    patchPlayback({ positionMs });
    if (commit) {
      pendingPcSeekRef.current = {
        positionMs,
        requestedAtMs: Date.now(),
        trackId: status?.playback.track?.id ?? null,
      };
      void sendCommand({ command: 'seekTo', positionMs }).finally(() => {
        sliderInteractionInFlight.current = false;
      });
    }
  }, [isPhoneOutput, patchPlayback, phonePlayer, playbackDurationMs, progressTrackWidth, sendCommand, status]);

  const updateVolumeFromGesture = useCallback((event: GestureResponderEvent, commit: boolean) => {
    if ((!status && !isPhoneOutput) || volumeTrackWidth <= 0) {
      return;
    }
    const volume = ratioFromGesture(event, volumeTrackWidth);
    if (isPhoneOutput) {
      phonePlayer.volume = volume;
      setPhoneVolume(volume);
      return;
    }
    sliderInteractionInFlight.current = !commit;
    patchPlayback({ volume });
    if (commit) {
      void sendCommand({ command: 'setVolume', volume });
    }
  }, [isPhoneOutput, patchPlayback, phonePlayer, sendCommand, status, volumeTrackWidth]);

  const handleProgressLayout = useCallback((event: LayoutChangeEvent) => {
    setProgressTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const handleVolumeLayout = useCallback((event: LayoutChangeEvent) => {
    setVolumeTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const pageTitle = page === 'connect'
    ? '连接电脑'
    : page === 'library'
      ? '曲库'
      : '正在播放';
  const pageDescription = page === 'connect'
    ? '用配对链接或局域网地址，让手机与 ECHO NEXT 桌面端建立同一套音乐空间。'
    : page === 'library'
      ? '浏览电脑端本地曲库，把歌曲从 PC 端自然接到手机端体验里。'
      : '同步 PC 端当前播放、曲库与音量，让手机和电脑保持同一段聆听进度。';

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <View style={styles.pageShell}>
          <ScrollView
            contentContainerStyle={[styles.content, page === 'control' ? styles.playerContent : null]}
            refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void refresh()} tintColor="#18181b" />}
            scrollEnabled={page !== 'control'}
          >
            {page !== 'control' ? (
              <View style={styles.header}>
                <Text style={styles.kicker}>ECHO iPhone</Text>
                <Text style={styles.title}>{pageTitle}</Text>
                <Text style={styles.description}>{pageDescription}</Text>
                <View style={[styles.statusPill, status ? styles.statusPillOnline : null]}>
                  <Text style={[styles.statusPillText, status ? styles.statusPillTextOnline : null]}>{connectedLabel}</Text>
                </View>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>连接异常</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {page === 'connect' ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.cardEyebrow}>Pair</Text>
                  <Text style={styles.cardTitle}>配对连接</Text>
                  <Text style={styles.hint}>
                    在电脑端打开 Connect / Mobile ECHO Link，复制或扫描二维码里的 echo://pair 链接，然后粘贴到这里。
                  </Text>
                  <TextInput
                    value={pairingText}
                    onChangeText={setPairingText}
                    placeholder="echo://pair?host=192.168.1.12&port=26789&token=..."
                    placeholderTextColor="#a8a29e"
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    style={[styles.input, styles.pairingInput]}
                  />
                  <Pressable
                    accessibilityLabel="使用配对链接连接电脑"
                    accessibilityRole="button"
                    style={styles.primaryButton}
                    onPress={() => void applyPairingText()}
                  >
                    <Text style={styles.primaryButtonText}>使用配对链接</Text>
                  </Pressable>
                </View>

                <View style={styles.section}>
                  <Text style={styles.cardEyebrow}>Manual</Text>
                  <Text style={styles.cardTitle}>手动连接</Text>
                  <TextInput
                    value={connection.host}
                    onChangeText={(host) => setConnection((current) => ({ ...current, host }))}
                    placeholder="电脑 IP，例如 192.168.1.12"
                    placeholderTextColor="#a8a29e"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <TextInput
                    value={String(connection.port)}
                    onChangeText={(port) => setConnection((current) => ({ ...current, port: Number(port) || 26789 }))}
                    placeholder="端口"
                    placeholderTextColor="#a8a29e"
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                  <TextInput
                    value={connection.token}
                    onChangeText={(token) => setConnection((current) => ({ ...current, token }))}
                    placeholder="Token"
                    placeholderTextColor="#a8a29e"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    style={styles.input}
                  />
                  <View style={styles.buttonRow}>
                    <Pressable
                      accessibilityLabel="保存手动连接"
                      accessibilityRole="button"
                      style={styles.secondaryButton}
                      onPress={() => void saveManualConnection()}
                    >
                      <Text style={styles.secondaryButtonText}>保存连接</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="测试电脑连接"
                      accessibilityRole="button"
                      style={styles.secondaryButton}
                      onPress={() => void refresh()}
                      disabled={!client || busy}
                    >
                      <Text style={styles.secondaryButtonText}>{busy ? '刷新中...' : '测试连接'}</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            ) : page === 'library' ? (
              <View style={styles.libraryPage}>
                <View style={styles.librarySearchRow}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    onSubmitEditing={() => void refresh()}
                    placeholder="搜索歌曲、艺术家或专辑"
                    placeholderTextColor="#9b9690"
                    style={[styles.input, styles.librarySearchInput]}
                  />
                  <Pressable
                    accessibilityLabel="刷新曲库"
                    accessibilityRole="button"
                    disabled={!client || busy}
                    onPress={() => void refresh()}
                    style={styles.libraryRefreshButton}
                  >
                    <Text style={styles.libraryRefreshText}>{busy ? '同步中' : '刷新'}</Text>
                  </Pressable>
                </View>

                {libraryError ? (
                  <View style={styles.warningBox}>
                    <Text style={styles.warningTitle}>曲库加载异常</Text>
                    <Text style={styles.warningText}>{libraryError}</Text>
                  </View>
                ) : null}

                <View style={styles.libraryList}>
                  {tracks.length > 0 ? tracks.map((item) => (
                    <Pressable
                      accessibilityLabel={`在电脑端播放 ${item.title}`}
                      accessibilityRole="button"
                      key={item.id}
                      style={styles.trackRow}
                      onPress={() => playTrackOnPc(item)}
                    >
                      <View style={styles.libraryArtwork}>
                        {item.artworkUrl ? (
                          <Image source={{ uri: item.artworkUrl }} style={styles.libraryArtworkImage} />
                        ) : (
                          <Text style={styles.libraryArtworkText}>E</Text>
                        )}
                      </View>
                      <View style={styles.trackText}>
                        <Text style={styles.listTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.listMeta} numberOfLines={1}>{item.artist}</Text>
                        <View style={styles.libraryTagRow}>
                          {tagsForTrack(item, { includeDuration: true }).map((tag) => (
                            <Text key={`${item.id}-${tag}`} style={styles.libraryTag}>{tag}</Text>
                          ))}
                        </View>
                      </View>
                      <Text style={styles.playInline}>▶</Text>
                    </Pressable>
                  )) : (
                    <Text style={styles.hint}>{client ? '暂无曲库结果' : '连接后会显示电脑端曲库'}</Text>
                  )}
                </View>
              </View>
            ) : (
              <>
                <View style={styles.playerCard}>
                  <View style={styles.artworkShell}>
                    {displayTrack?.artworkUrl ? (
                      <Image source={{ uri: displayTrack.artworkUrl }} style={styles.artworkImage} />
                    ) : (
                      <View style={styles.artworkFallback}>
                        <Text style={styles.artworkFallbackText}>ECHO</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.trackTitle} numberOfLines={2}>{displayTrack?.title ?? '没有正在播放的歌曲'}</Text>
                  <View style={styles.playbackTagRow}>
                    {playbackTags.map((tag) => (
                      <Text key={tag} style={styles.playbackTag}>{tag}</Text>
                    ))}
                  </View>
                  <View style={styles.outputSwitch}>
                    <Pressable
                      accessibilityLabel="控制电脑播放"
                      accessibilityRole="button"
                      disabled={!client || phoneAudioBusy}
                      onPress={switchToPcPlayback}
                      style={[styles.outputSwitchButton, !isPhoneOutput ? styles.outputSwitchButtonActive : null]}
                    >
                      <Text style={[styles.outputSwitchText, !isPhoneOutput ? styles.outputSwitchTextActive : null]}>
                        控制
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="串流到手机播放"
                      accessibilityRole="button"
                      disabled={!client || phoneAudioBusy}
                      onPress={switchToPhonePlayback}
                      style={[styles.outputSwitchButton, isPhoneOutput ? styles.outputSwitchButtonActive : null]}
                    >
                      <Text style={[styles.outputSwitchText, isPhoneOutput ? styles.outputSwitchTextActive : null]}>
                        {phoneAudioBusy ? '...' : '串流'}
                      </Text>
                    </Pressable>
                  </View>
                  {phoneAudioError ? (
                    <Text style={styles.phoneAudioError}>{phoneAudioError}</Text>
                  ) : null}
                  <View
                    style={styles.sliderTouchArea}
                    onLayout={handleProgressLayout}
                    onStartShouldSetResponder={() => Boolean((client || isPhoneOutput) && playbackDurationMs)}
                    onMoveShouldSetResponder={() => Boolean((client || isPhoneOutput) && playbackDurationMs)}
                    onResponderGrant={(event) => updateSeekFromGesture(event, false)}
                    onResponderMove={(event) => updateSeekFromGesture(event, false)}
                    onResponderRelease={(event) => updateSeekFromGesture(event, true)}
                    onResponderTerminate={(event) => updateSeekFromGesture(event, true)}
                  >
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
                    </View>
                    <View pointerEvents="none" style={[styles.sliderThumb, { left: `${progressRatio * 100}%` }]} />
                  </View>
                  <View style={styles.timeRow}>
                    <Text style={styles.progressText}>{displayTrack ? formatTime(playbackPositionMs) : '0:00'}</Text>
                    <Text style={styles.progressText}>{displayTrack ? formatTime(playbackDurationMs) : '0:00'}</Text>
                  </View>
                  <View style={styles.transportRow}>
                    <Pressable
                      accessibilityLabel="上一首"
                      accessibilityRole="button"
                      style={styles.roundButton}
                      onPress={playPrevious}
                      disabled={!client && !isPhoneOutput}
                    >
                      <Text style={styles.roundButtonText}>‹</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={isPlaybackActive ? '暂停播放' : '开始播放'}
                      accessibilityRole="button"
                      style={styles.playButton}
                      onPress={togglePlayPause}
                      disabled={!client && !isPhoneOutput}
                    >
                      <Text style={styles.playButtonText}>{isPlaybackActive ? 'Ⅱ' : '▶'}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="下一首"
                      accessibilityRole="button"
                      style={styles.roundButton}
                      onPress={playNext}
                      disabled={!client && !isPhoneOutput}
                    >
                      <Text style={styles.roundButtonText}>›</Text>
                    </Pressable>
                  </View>

                  <View style={styles.playlistActionRow}>
                    <Pressable
                      accessibilityLabel={playlistOpen ? '关闭播放列表预览' : '打开播放列表预览'}
                      accessibilityRole="button"
                      onPress={() => setPlaylistOpen((current) => !current)}
                      style={[styles.playlistMiniButton, playlistOpen ? styles.playlistMiniButtonActive : null]}
                    >
                      <Text style={styles.playlistMiniIcon}>☰</Text>
                      <Text style={styles.playlistMiniCount}>{playlistItems.length}</Text>
                    </Pressable>
                  </View>

                  <View style={styles.playerDivider} />
                  <View style={styles.volumePanel}>
                    <View style={styles.volumeHeader}>
                      <Text style={styles.cardEyebrow}>VOL</Text>
                      <Text style={styles.volumeValue}>{volumePercent}%</Text>
                    </View>
                    <View
                      style={styles.sliderTouchArea}
                      onLayout={handleVolumeLayout}
                      onStartShouldSetResponder={() => Boolean(client || isPhoneOutput)}
                      onMoveShouldSetResponder={() => Boolean(client || isPhoneOutput)}
                      onResponderGrant={(event) => updateVolumeFromGesture(event, false)}
                      onResponderMove={(event) => updateVolumeFromGesture(event, false)}
                      onResponderRelease={(event) => updateVolumeFromGesture(event, true)}
                      onResponderTerminate={(event) => updateVolumeFromGesture(event, true)}
                    >
                      <View style={styles.volumeTrack}>
                        <View style={[styles.volumeFill, { width: `${volumePercent}%` }]} />
                      </View>
                      <View pointerEvents="none" style={[styles.sliderThumb, { left: `${volumePercent}%` }]} />
                    </View>
                  </View>
                </View>
              </>
            )}
          </ScrollView>

          {page === 'control' && playlistOpen ? (
            <View style={styles.playlistOverlay} pointerEvents="box-none">
              <Pressable
                accessibilityLabel="关闭播放列表预览"
                accessibilityRole="button"
                onPress={() => setPlaylistOpen(false)}
                style={styles.playlistBackdrop}
              />
              <View style={styles.playlistPopover}>
                <View style={styles.playlistPopoverHeader}>
                  <View>
                    <Text style={styles.playlistPopoverEyebrow}>Queue</Text>
                    <Text style={styles.playlistPopoverTitle}>播放列表</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="关闭播放列表"
                    accessibilityRole="button"
                    onPress={() => setPlaylistOpen(false)}
                    style={styles.playlistCloseButton}
                  >
                    <Text style={styles.playlistCloseText}>×</Text>
                  </Pressable>
                </View>
                <View style={styles.playlistPopoverList}>
                  {visiblePlaylistItems.length > 0 ? visiblePlaylistItems.map((item, index) => {
                    const isCurrentTrack = item.id === playbackQueue?.currentTrackId || item.id === displayTrack?.id;
                    return (
                      <Pressable
                        accessibilityLabel={`播放列表第 ${index + 1} 首：${item.title}`}
                        accessibilityRole="button"
                        key={`${item.id}-${index}`}
                        onPress={() => {
                          setPlaylistOpen(false);
                          if (isPhoneOutput) {
                            void playTrackOnPhone(item, 0, false);
                            return;
                          }
                          playTrackOnPc(item);
                        }}
                        style={[styles.playlistItem, isCurrentTrack ? styles.playlistItemActive : null]}
                      >
                        <Text style={[styles.playlistIndex, isCurrentTrack ? styles.playlistIndexActive : null]}>
                          {String(index + 1).padStart(2, '0')}
                        </Text>
                        <View style={styles.playlistText}>
                          <Text style={[styles.playlistTitle, isCurrentTrack ? styles.playlistTitleActive : null]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.playlistMeta} numberOfLines={1}>
                            {item.artist} · {item.album || item.sourceLabel}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  }) : (
                    <Text style={styles.playlistEmpty}>当前播放队列暂无内容。之后这里会承接 PC 与手机互通的播放列表。</Text>
                  )}
                </View>
                {hiddenPlaylistItemCount > 0 ? (
                  <Text style={styles.playlistMore}>还有 {hiddenPlaylistItemCount} 首在队列中</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.dock}>
            <Pressable
              accessibilityLabel="播放页面"
              accessibilityRole="button"
              style={[styles.dockItem, page === 'control' ? styles.dockItemActive : null]}
              onPress={() => setPage('control')}
            >
              <Text style={[styles.dockIcon, page === 'control' ? styles.dockIconActive : null]}>▶</Text>
              <Text style={[styles.dockLabel, page === 'control' ? styles.dockLabelActive : null]}>播放</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="曲库页面"
              accessibilityRole="button"
              style={[styles.dockItem, page === 'library' ? styles.dockItemActive : null]}
              onPress={() => setPage('library')}
            >
              <Text style={[styles.dockIcon, page === 'library' ? styles.dockIconActive : null]}>♬</Text>
              <Text style={[styles.dockLabel, page === 'library' ? styles.dockLabelActive : null]}>曲库</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="连接页面"
              accessibilityRole="button"
              style={[styles.dockItem, page === 'connect' ? styles.dockItemActive : null]}
              onPress={() => setPage('connect')}
            >
              <Text style={[styles.dockIcon, page === 'connect' ? styles.dockIconActive : null]}>⌁</Text>
              <Text style={[styles.dockLabel, page === 'connect' ? styles.dockLabelActive : null]}>连接</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function App(): ReactElement {
  return (
    <AppErrorBoundary>
      <EchoLinkApp />
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  root: {
    flex: 1,
  },
  pageShell: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 124,
    gap: 16,
  },
  playerContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 106,
    paddingTop: 10,
  },
  header: {
    gap: 10,
    paddingTop: 14,
  },
  kicker: {
    color: '#8a8178',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: '#18181b',
    fontSize: 34,
    fontWeight: '800',
  },
  description: {
    color: '#706b66',
    fontSize: 15,
    lineHeight: 23,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.58)',
    borderColor: 'rgba(39, 39, 42, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusPillOnline: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderColor: 'rgba(24, 24, 27, 0.12)',
  },
  statusPillText: {
    color: '#706b66',
    fontSize: 12,
    fontWeight: '800',
  },
  statusPillTextOnline: {
    color: '#27272a',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: 'rgba(39, 39, 42, 0.08)',
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
  },
  section: {
    borderBottomColor: 'rgba(39, 39, 42, 0.08)',
    borderBottomWidth: 1,
    gap: 12,
    paddingBottom: 20,
    paddingTop: 4,
  },
  cardEyebrow: {
    color: '#8a8178',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: '#18181b',
    fontSize: 18,
    fontWeight: '800',
  },
  hint: {
    color: '#706b66',
    fontSize: 13,
    lineHeight: 19,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.64)',
    borderColor: 'rgba(39, 39, 42, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    color: '#18181b',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pairingInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 16,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderColor: 'rgba(39, 39, 42, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: '#27272a',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  errorBox: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  errorTitle: {
    color: '#be123c',
    fontWeight: '800',
  },
  errorText: {
    color: '#be123c',
    fontSize: 13,
    lineHeight: 18,
  },
  warningBox: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  warningTitle: {
    color: '#a16207',
    fontWeight: '800',
  },
  warningText: {
    color: '#92400e',
    fontSize: 13,
    lineHeight: 18,
  },
  playerCard: {
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 2,
    paddingTop: 0,
  },
  artworkShell: {
    alignItems: 'center',
    backgroundColor: '#eeeeee',
    borderColor: 'rgba(39, 39, 42, 0.08)',
    borderRadius: 22,
    borderWidth: 1,
    height: 272,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    width: '100%',
  },
  artworkImage: {
    height: '100%',
    width: '100%',
  },
  artworkFallback: {
    alignItems: 'center',
    backgroundColor: '#e5e5e5',
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  artworkFallbackText: {
    color: '#71717a',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 4,
  },
  trackTitle: {
    color: '#18181b',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  trackMeta: {
    color: '#706b66',
    fontSize: 14,
    textAlign: 'center',
  },
  playbackTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    minHeight: 24,
  },
  playbackTag: {
    borderColor: 'rgba(24, 24, 27, 0.12)',
    borderRadius: 999,
    borderWidth: 1,
    color: '#3f3f46',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  outputSwitch: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    borderColor: 'rgba(39, 39, 42, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  outputSwitchButton: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  outputSwitchButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  outputSwitchText: {
    color: '#706b66',
    fontSize: 12,
    fontWeight: '800',
  },
  outputSwitchTextActive: {
    color: '#18181b',
  },
  phoneAudioError: {
    alignSelf: 'stretch',
    color: '#9f1239',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  progressTrack: {
    backgroundColor: '#e5e5e5',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  sliderTouchArea: {
    justifyContent: 'center',
    minHeight: 34,
    position: 'relative',
    width: '100%',
  },
  sliderThumb: {
    backgroundColor: '#ffffff',
    borderColor: '#18181b',
    borderRadius: 999,
    borderWidth: 3,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    position: 'absolute',
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    top: '50%',
    width: 22,
  },
  progressFill: {
    backgroundColor: '#18181b',
    borderRadius: 999,
    height: '100%',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  progressText: {
    color: '#706b66',
    fontVariant: ['tabular-nums'],
  },
  transportRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    width: '100%',
  },
  roundButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
    borderColor: 'rgba(39, 39, 42, 0.1)',
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    minHeight: 42,
    paddingVertical: 8,
  },
  roundButtonText: {
    color: '#27272a',
    fontSize: 26,
    fontWeight: '900',
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 999,
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
  },
  playButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  playlistActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: -4,
    width: '100%',
  },
  playlistMiniButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: 'rgba(39, 39, 42, 0.1)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 12,
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  playlistMiniButtonActive: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(24, 24, 27, 0.18)',
  },
  playlistMiniIcon: {
    color: '#18181b',
    fontSize: 15,
    fontWeight: '900',
  },
  playlistMiniCount: {
    color: '#706b66',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  playlistOverlay: {
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingBottom: 116,
    paddingHorizontal: 22,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  playlistBackdrop: {
    backgroundColor: 'rgba(245, 245, 245, 0.38)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  playlistPopover: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderColor: 'rgba(39, 39, 42, 0.1)',
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: 380,
    padding: 16,
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.14,
    shadowRadius: 36,
    width: '100%',
  },
  playlistPopoverHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  playlistPopoverEyebrow: {
    color: '#8a8178',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  playlistPopoverTitle: {
    color: '#18181b',
    fontSize: 19,
    fontWeight: '900',
  },
  playlistCloseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(244, 244, 245, 0.92)',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  playlistCloseText: {
    color: '#3f3f46',
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
  },
  playlistPopoverList: {
    gap: 0,
  },
  playlistItem: {
    alignItems: 'center',
    borderBottomColor: 'rgba(39, 39, 42, 0.07)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingVertical: 9,
  },
  playlistItemActive: {
    backgroundColor: 'rgba(24, 24, 27, 0.06)',
    borderRadius: 14,
    borderBottomWidth: 0,
    paddingHorizontal: 10,
  },
  playlistIndex: {
    color: '#9b9690',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    width: 24,
  },
  playlistIndexActive: {
    color: '#18181b',
  },
  playlistText: {
    flex: 1,
    gap: 2,
  },
  playlistTitle: {
    color: '#18181b',
    fontSize: 14,
    fontWeight: '800',
  },
  playlistTitleActive: {
    color: '#18181b',
  },
  playlistMeta: {
    color: '#706b66',
    fontSize: 12,
  },
  playlistEmpty: {
    color: '#706b66',
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 10,
  },
  playlistMore: {
    color: '#8a8178',
    fontSize: 12,
    fontWeight: '700',
    paddingTop: 8,
    textAlign: 'center',
  },
  playerDivider: {
    backgroundColor: 'rgba(39, 39, 42, 0.08)',
    height: 1,
    marginTop: 4,
    width: '100%',
  },
  volumePanel: {
    gap: 6,
    width: '100%',
  },
  volumeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  volumeValue: {
    color: '#18181b',
    fontSize: 14,
    fontWeight: '900',
  },
  volumeTrack: {
    backgroundColor: '#e5e5e5',
    borderRadius: 999,
    height: 12,
    overflow: 'hidden',
  },
  volumeFill: {
    backgroundColor: '#18181b',
    borderRadius: 999,
    height: '100%',
  },
  libraryList: {
    gap: 0,
  },
  libraryPage: {
    gap: 14,
  },
  librarySearchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  librarySearchInput: {
    flex: 1,
  },
  libraryRefreshButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderColor: 'rgba(39, 39, 42, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 46,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  libraryRefreshText: {
    color: '#27272a',
    fontSize: 14,
    fontWeight: '800',
  },
  trackRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(39, 39, 42, 0.08)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 66,
    paddingVertical: 10,
  },
  libraryArtwork: {
    alignItems: 'center',
    backgroundColor: '#e5e5e5',
    borderColor: 'rgba(39, 39, 42, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 46,
  },
  libraryArtworkImage: {
    height: '100%',
    width: '100%',
  },
  libraryArtworkText: {
    color: '#71717a',
    fontSize: 16,
    fontWeight: '900',
  },
  trackBadge: {
    alignItems: 'center',
    backgroundColor: '#e5e5e5',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  trackBadgeText: {
    color: '#52525b',
    fontSize: 16,
    fontWeight: '900',
  },
  trackText: {
    flex: 1,
    gap: 3,
  },
  listTitle: {
    color: '#18181b',
    fontSize: 15,
    fontWeight: '800',
  },
  listMeta: {
    color: '#706b66',
    fontSize: 12,
  },
  libraryTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  libraryTag: {
    borderColor: 'rgba(24, 24, 27, 0.12)',
    borderRadius: 999,
    borderWidth: 1,
    color: '#52525b',
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  playInline: {
    color: '#18181b',
    fontSize: 15,
    fontWeight: '900',
  },
  dock: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    borderColor: 'rgba(255, 255, 255, 0.72)',
    borderRadius: 30,
    borderWidth: 1,
    bottom: 16,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    left: 18,
    padding: 8,
    position: 'absolute',
    right: 18,
    shadowColor: '#18181b',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
  },
  dockItem: {
    alignItems: 'center',
    borderRadius: 22,
    flex: 1,
    gap: 3,
    paddingVertical: 10,
  },
  dockItemActive: {
    backgroundColor: 'rgba(24, 24, 27, 0.1)',
  },
  dockIcon: {
    color: '#8a8178',
    fontSize: 20,
    fontWeight: '900',
  },
  dockIconActive: {
    color: '#18181b',
  },
  dockLabel: {
    color: '#8a8178',
    fontSize: 12,
    fontWeight: '800',
  },
  dockLabelActive: {
    color: '#18181b',
  },
});
