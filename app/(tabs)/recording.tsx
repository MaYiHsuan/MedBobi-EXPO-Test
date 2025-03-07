import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, Alert, Platform, PermissionsAndroid, StyleSheet, AppState, AppStateStatus } from 'react-native';
import AudioRecord from 'react-native-audio-record';
import Sound from 'react-native-sound';
import * as FileSystem from 'expo-file-system';
import { IconSymbol } from '@/components/ui/IconSymbol';
import Slider from '@react-native-community/slider';
import BackgroundTimer from 'react-native-background-timer';
import PushNotification from 'react-native-push-notification';
import ForegroundService from 'react-native-foreground-service';
const { startService, stopService } = ForegroundService;

export default function AudioRecorderScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioFile, setAudioFile] = useState('');
  const [hasRecording, setHasRecording] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [wsStatus, setWsStatus] = useState('未連接'); // WebSocket 狀態
  
  // 使用 useRef 來保存 Sound 對象，確保它在組件重新渲染時不會丟失
  const sound = useRef<Sound | null>(null);
  const playbackTimer = useRef<number | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const appState = useRef(AppState.currentState);
  const webSocket = useRef<WebSocket | null>(null); // 用於保存 WebSocket 連線

  useEffect(() => {
    setupNotifications();
    Sound.setCategory('Playback');
    
    // 設置音頻錄製選項 - 使用臨時目錄
    const options = {
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 16,
      wavFile: 'temp_recording.wav',
      audioSource: 6, // MIC
      outputFormat: 2, // AAC_ADTS
      audioEncoder: 3 // AAC
    };

    // 初始化錄音機
    AudioRecord.init(options);

    // 請求權限
    requestPermission();

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // 初始化 WebSocket 連線
    initWebSocket();

    // 組件卸載時清理
    return () => {
      if (isRecording) {
        stopRecordingInternal();
      }
      
      if (sound.current) {
        sound.current.release();
      }
      
      if (playbackTimer.current) {
        BackgroundTimer.clearInterval(playbackTimer.current);
      }

      if (recordingTimer.current) {
        BackgroundTimer.clearInterval(recordingTimer.current);
      }
      
      // 清理臨時文件
      cleanupTempFile();

      // 清理 WebSocket 連線
      cleanupWebSocket();

      subscription.remove();

      if (Platform.OS === 'android') {
        stopService();
      }
    };
  }, []);

  // 初始化 WebSocket 連線
  const initWebSocket = () => {
    try {
      // 清理現有連線（如果有）
      cleanupWebSocket();
      
      // 建立新連線
      const wsUrl = 'wss://medbobi-api.bdlai.net/v1/AI/audioInference/multilingual';
      webSocket.current = new WebSocket(wsUrl);
      
      // 設置事件處理器
      webSocket.current.onopen = () => {
        console.log('WebSocket 連線已建立');
        setWsStatus('已連接');
      };
      
      webSocket.current.onmessage = (event) => {
        console.log('收到 WebSocket 訊息:', event.data);
        // 這裡可以處理從伺服器收到的訊息
      };
      
      webSocket.current.onerror = (error) => {
        console.error('WebSocket 錯誤:', error);
        setWsStatus('連接錯誤');
      };
      
      webSocket.current.onclose = (event) => {
        console.log('WebSocket 連線已關閉:', event.code, event.reason);
        setWsStatus('已斷開');
      };
      
    } catch (error) {
      console.error('初始化 WebSocket 失敗:', error);
      setWsStatus('初始化失敗');
    }
  };

  // 清理 WebSocket 連線
  const cleanupWebSocket = () => {
    if (webSocket.current) {
      if (webSocket.current.readyState === WebSocket.OPEN || 
          webSocket.current.readyState === WebSocket.CONNECTING) {
        webSocket.current.close();
      }
      webSocket.current = null;
      setWsStatus('已斷開');
    }
  };

  const setupNotifications = () => {
    PushNotification.configure({
      onNotification: function (notification) {
        console.log('NOTIFICATION:', notification);
      },
      popInitialNotification: true,
      requestPermissions: Platform.OS === 'ios',
    });

    PushNotification.createChannel(
      {
        channelId: 'recording-channel',
        channelName: 'Recording Channel',
        channelDescription: 'Channel for recording notifications',
        playSound: false,
        vibrate: false,
      },
      (created) => console.log(`Channel created: ${created}`)
    );
  };

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (isRecording && appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
      // 應用進入背景，確保錄音繼續
      showRecordingNotification();
    } else if (isRecording && appState.current.match(/inactive|background/) && nextAppState === 'active') {
      // 應用回到前台
      PushNotification.cancelAllLocalNotifications();
    }
    
    appState.current = nextAppState;
  };

  const showRecordingNotification = () => {
    PushNotification.localNotification({
      channelId: 'recording-channel',
      title: '錄音進行中',
      message: `已錄製 ${formatTime(recordingDuration)}`,
      ongoing: true,
      autoCancel: false,
      id: 1001,
    });
  };

  const startForegroundService = async () => {
    if (Platform.OS !== 'android') return;
    
    await ForegroundService.startService({
      id: 1244,
      title: '錄音進行中',
      message: '點擊返回應用',
      icon: 'ic_launcher',
    });
  };

  const stopForegroundService = () => {
    if (Platform.OS !== 'android') return;
    
    ForegroundService.stopService();
  };

  const requestPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const grants = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);

        if (
          grants['android.permission.WRITE_EXTERNAL_STORAGE'] === PermissionsAndroid.RESULTS.GRANTED &&
          grants['android.permission.READ_EXTERNAL_STORAGE'] === PermissionsAndroid.RESULTS.GRANTED &&
          grants['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.GRANTED
        ) {
          console.log('所有權限已獲得');
        } else {
          Alert.alert('權限錯誤', '需要錄音和存儲權限才能使用此功能');
        }
      } catch (err) {
        console.warn('權限請求錯誤:', err);
        Alert.alert('權限錯誤', '請求權限時出錯');
      }
    }
  };

  const startRecording = async () => {
    // 如果有現有錄音，先清理
    if (hasRecording) {
      cleanupRecording();
    }
    
    try {
      if (Platform.OS === 'android') {
        await startForegroundService();
      }
      
      // 確保 WebSocket 連線已建立
      if (!webSocket.current || webSocket.current.readyState !== WebSocket.OPEN) {
        initWebSocket();
      }
      
      // 添加 data 監聽器，用於獲取音訊數據
      AudioRecord.on('data', (data) => {
        // 這裡可以獲取到原始音訊數據（二進制格式）
        console.log('收到音訊數據，大小:', data.length);
        // 目前不傳送數據到 WebSocket
      });
      
      AudioRecord.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimer.current = BackgroundTimer.setInterval(() => {
        setRecordingDuration(prev => {
          const newDuration = prev + 1;
          
          // 如果應用在背景，更新通知
          if (appState.current.match(/inactive|background/)) {
            PushNotification.localNotification({
              channelId: 'recording-channel',
              title: '錄音進行中',
              message: `已錄製 ${formatTime(newDuration)}`,
              ongoing: true,
              autoCancel: false,
              id: 1001,  // 使用相同的 ID 來更新同一個通知
            });
          }
          
          return newDuration;
        });
      }, 1000);

      console.log('開始錄音');
    } catch (error) {
      console.error('開始錄音失敗:', error);
      Alert.alert('錄音錯誤', '無法開始錄音');
      stopForegroundService();
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    
    try {
      const audioFile = await stopRecordingInternal();
      setAudioFile(audioFile);
      setHasRecording(true);
      console.log('錄音結束，文件保存在:', audioFile);
    } catch (error) {
      console.error('停止錄音失敗:', error);
      Alert.alert('錄音錯誤', '停止錄音時出錯');
    }
  };

  const stopRecordingInternal = async () => {
    // 停止前台服務
    stopForegroundService();
    
    // 取消通知
    PushNotification.cancelAllLocalNotifications();
    
    // 停止錄音計時器
    if (recordingTimer.current) {
      BackgroundTimer.clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
    
    // 停止錄音
    const audioFile = await AudioRecord.stop();
    setIsRecording(false);
    
    return audioFile;
  };

  const playRecording = () => {
    if (!audioFile || isPlaying) return;
    
    // 釋放之前的 Sound 對象（如果存在）
    if (sound.current) {
      sound.current.release();
    }
    
    // 創建新的 Sound 對象
    sound.current = new Sound(audioFile, '', (error) => {
      if (error) {
        console.error('加載音頻失敗:', error);
        Alert.alert('播放錯誤', '無法加載音頻文件');
        return;
      }
      
      // 獲取音頻時長
      const duration = sound.current?.getDuration() || 0;
      setAudioDuration(duration);
      
      // 播放音頻
      setIsPlaying(true);
      setPlaybackProgress(0);
      
      sound.current?.play((success) => {
        if (success) {
          console.log('播放完成');
        } else {
          console.log('播放失敗');
        }
        setIsPlaying(false);
        setPlaybackProgress(0);
        
        // 清除進度條計時器
        if (playbackTimer.current) {
          clearInterval(playbackTimer.current);
          playbackTimer.current = null;
        }
      });
      
      // 設置進度條更新計時器
      playbackTimer.current = BackgroundTimer.setInterval(() => {
        if (sound.current) {
          sound.current.getCurrentTime((seconds) => {
            setPlaybackProgress(seconds);
          });
        }
      }, 100);
    });
  };

  const stopPlayback = () => {
    if (sound.current && isPlaying) {
      sound.current.stop();
      setIsPlaying(false);
      setPlaybackProgress(0);
      
      // 清除進度條計時器
      if (playbackTimer.current) {
        BackgroundTimer.clearInterval(playbackTimer.current);
        playbackTimer.current = null;
      }
    }
  };

  const seekToPosition = (value: number) => {
    if (sound.current) {
      sound.current.setCurrentTime(value);
    }
  };

  const cleanupRecording = () => {
    // 停止播放
    if (sound.current) {
      sound.current.stop();
      sound.current.release();
      sound.current = null;
    }
    
    // 清除進度條計時器
    if (playbackTimer.current) {
      BackgroundTimer.clearInterval(playbackTimer.current);
      playbackTimer.current = null;
    }
    
    // 清理臨時文件
    cleanupTempFile();
    
    // 重置狀態
    setAudioFile('');
    setHasRecording(false);
    setIsPlaying(false);
    setPlaybackProgress(0);
    setAudioDuration(0);
  };

  const cleanupTempFile = () => {
    // 如果有臨時文件，嘗試刪除
    if (audioFile) {
      try {
        // 檢查文件是否存在，然後刪除
        FileSystem.deleteAsync(audioFile, { idempotent: true })
          .catch(error => console.log('刪除臨時文件錯誤:', error));
      } catch (error) {
        console.log('刪除臨時文件時出錯:', error);
      }
    }
  };

  // 格式化時間為 mm:ss 格式
  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>
        {isRecording 
          ? `錄音中: ${formatTime(recordingDuration)}` 
          : isPlaying 
            ? '播放中' 
            : '就緒'}
      </Text>
      
      <Text style={styles.wsStatusText}>
        WebSocket: {wsStatus}
      </Text>
      
      <View style={styles.recordButtonContainer}>
        <TouchableOpacity 
          style={[styles.iconButton, isRecording ? styles.recordingButton : styles.recordButton]}
          onPress={isRecording ? stopRecording : startRecording}
          disabled={isPlaying}
        >
          <IconSymbol 
            name={isRecording ? "stop" : "mic"} 
            size={30} 
            color="white" 
          />
        </TouchableOpacity>
        <Text style={styles.buttonLabel}>
          {isRecording ? "停止錄音" : "開始錄音"}
        </Text>
      </View>
      
      {hasRecording && (
        <View style={styles.playbackContainer}>
          <View style={styles.playControlsContainer}>
            <TouchableOpacity 
              style={[styles.iconButton, styles.playButton]}
              onPress={isPlaying ? stopPlayback : playRecording}
              disabled={isRecording}
            >
              <IconSymbol 
                name={isPlaying ? "pause" : "play"} 
                size={24} 
                color="white" 
              />
            </TouchableOpacity>
            <Text style={styles.buttonLabel}>
              {isPlaying ? "暫停" : "播放"}
            </Text>
          </View>
          
          <View style={styles.progressContainer}>
            <Text style={styles.timeText}>{formatTime(playbackProgress)}</Text>
            <Slider
              style={styles.progressBar}
              minimumValue={0}
              maximumValue={audioDuration > 0 ? audioDuration : 1}
              value={playbackProgress}
              onSlidingComplete={seekToPosition}
              minimumTrackTintColor="#4285F4"
              maximumTrackTintColor="#D3D3D3"
              thumbTintColor="#4285F4"
              disabled={!hasRecording || isRecording}
            />
            <Text style={styles.timeText}>{formatTime(audioDuration)}</Text>
          </View>
          
          <TouchableOpacity 
            style={[styles.iconButton, styles.deleteButton]}
            onPress={cleanupRecording}
            disabled={isRecording}
          >
            <IconSymbol name="trash" size={20} color="white" />
          </TouchableOpacity>
        </View>
      )}
      
      <Text style={styles.backgroundNote}>
        {isRecording ? "錄音將在背景繼續進行" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  statusText: {
    fontSize: 18,
    marginBottom: 10,
    color: '#333',
  },
  wsStatusText: {
    fontSize: 14,
    marginBottom: 20,
    color: '#666',
  },
  recordButtonContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  iconButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  recordButton: {
    backgroundColor: '#4285F4',
  },
  recordingButton: {
    backgroundColor: '#EA4335',
  },
  playButton: {
    backgroundColor: '#34A853',
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  deleteButton: {
    backgroundColor: '#EA4335',
    width: 40,
    height: 40,
    borderRadius: 20,
    marginTop: 20,
  },
  buttonLabel: {
    marginTop: 8,
    fontSize: 14,
    color: '#333',
  },
  playbackContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 20,
  },
  playControlsContainer: {
    alignItems: 'center',
    marginBottom: 15,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 10,
  },
  progressBar: {
    flex: 1,
    height: 40,
    marginHorizontal: 10,
  },
  timeText: {
    fontSize: 12,
    color: '#666',
    width: 40,
    textAlign: 'center',
  },
  backgroundNote: {
    marginTop: 20,
    color: '#666',
    fontStyle: 'italic',
  }
});
