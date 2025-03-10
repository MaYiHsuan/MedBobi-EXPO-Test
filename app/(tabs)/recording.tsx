import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, Alert, Platform, PermissionsAndroid, StyleSheet, AppState, AppStateStatus, Share, TextInput } from 'react-native';
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
  const [wsStatusMessage, setWsStatusMessage] = useState(''); // WebSocket 狀態訊息
  const [wsMessage, setWsMessage] = useState(''); // WebSocket 回傳訊息
  
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
      sampleRate: 16000,
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
  const initWebSocket = async() => {
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
        setWsStatusMessage(''); // 清除之前的狀態訊息
      };

      webSocket.current.onmessage = (event) => {
        console.log('收到 WebSocket 訊息:', event.data);
        setWsMessage(prevMessage => prevMessage + event.data + '\n');
      };

      webSocket.current.onerror = (error) => {
        console.error('WebSocket 錯誤:', error);
        setWsStatus('連接錯誤');
        setWsStatusMessage(getErrorMessage(error));
      };

      webSocket.current.onclose = (event) => {
        let message = '';
        switch (event.code) {
          case 1000:
            message = '正常關閉';
            break;
          case 1001:
            message = '終端離開';
            break;
          case 1002:
            message = '協定錯誤';
            break;
          case 1003:
            message = '不支援的資料';
            break;
          case 1007:
            message = '無效的資料';
            break;
          case 1008:
            message = '違反政策';
            break;
          case 1009:
            message = '訊息太大';
            break;
          case 1011:
            message = '伺服器內部錯誤';
            break;
          default:
            message = `未知錯誤 (Code: ${event.code})`;
        }
        console.log(`WebSocket 連線已關閉: ${event.code} - ${message}`);
        setWsStatus('已斷開');
        setWsStatusMessage(`關閉原因：${message}`); // 設定關閉原因
        
        // 如果不是正常關閉，嘗試重新連線
        if(event.code !== 1000){
            setTimeout(() => {
                initWebSocket();
            }, 3000);  // 3秒後重新連接
        }
      };
    } catch (error) {
      console.error('初始化 WebSocket 失敗:', error);
      setWsStatus('初始化失敗');
      setWsStatusMessage((error as Error).message || '未知錯誤');
    }

    const getErrorMessage = (error: Event) => {
      if (typeof error === 'string') {
        return error;
      } else if (error && typeof error.toString === 'function') {
        // 嘗試呼叫 toString() 方法
        const errorString = error.toString();
        if (errorString !== '[object Object]') { // 檢查是否為預設的物件字串表示
          return errorString;
        }
      }
      return '未知錯誤';
    };
  };

  // 清理 WebSocket 連線
  const cleanupWebSocket = () => {
    if (webSocket.current) {
      try {
        // 避免在 CLOSING 或 CLOSED 狀態下呼叫 close()
        if (webSocket.current.readyState === WebSocket.OPEN || webSocket.current.readyState === WebSocket.CONNECTING)
        {
            webSocket.current.close(1000, "Client initiated close"); // 使用 1000 正常關閉
        }
      } catch (e)
      {
          console.error("Error closing WebSocket:", e);
      }
      webSocket.current = null;
      setWsStatus('已斷開');
      setWsStatusMessage(''); // 清除狀態訊息
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
        await initWebSocket();
      }
      
      // 添加 data 監聽器，用於獲取音訊數據
      AudioRecord.on('data', (data) => {
        // 檢查 WebSocket 連線狀態
        if (webSocket.current && webSocket.current.readyState === WebSocket.OPEN) {
          try {
            // 複製數據並轉換
            // 假設 data 是 base64 字符串
            // 1. 將 base64 字符串解碼為二進制字符串
            const binaryString = atob(data);
            
            // 2. 創建一個與二進制字符串長度相同的 Uint8Array
            const uint8Array = new Uint8Array(binaryString.length);
            
            // 3. 將二進制字符串中的每個字符轉換為其 Unicode 編碼，並存儲在 Uint8Array 中
            for (let i = 0; i < binaryString.length; i++) {
              uint8Array[i] = binaryString.charCodeAt(i);
            }
            
            // 4. 將 Uint8Array 轉換為 Float32Array
            //    由於 react-native-audio-record 預設輸出 16-bit PCM，
            //    我們需要將 Uint8Array 轉換為 Int16Array，然後再轉換為 Float32Array
            const int16Array = new Int16Array(uint8Array.buffer);
            const float32Array = new Float32Array(int16Array.length);
            
            for (let i = 0; i < int16Array.length; i++) {
              float32Array[i] = int16Array[i] / 32768.0; // 將 Int16 範圍 (-32768 to 32767) 映射到 Float32 範圍 (-1 to 1)
            }
            
            // 5. 驗證數據類型 - 在控制台中打印數據類型和部分數據
            // console.log('音訊數據類型:', float32Array.constructor.name);
            // console.log('部分音訊數據:', float32Array.slice(0, 10));
            
            // 6. 從 Float32Array 創建 ArrayBuffer
            const arrayBuffer = float32Array.buffer;
            
            // 7. 發送 ArrayBuffer 到 WebSocket 伺服器
            webSocket.current.send(arrayBuffer);
        
          } catch (error) {
            console.error('發送音訊數據到 WebSocket 時出錯:', error);
          }
        } else {
          console.log('WebSocket 未連接，無法發送音訊數據');
        }
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


  const shareAudioFile = async () => {
    if (!audioFile) {
      Alert.alert('錯誤', '沒有可分享的音訊檔案');
      return;
    }
  
    try {
      await Share.share({
        url: audioFile, // 檔案的 URL
        title: '分享音訊檔案', // 分享對話框的標題
      });
    } catch (error) {
      console.error('分享失敗:', error);
      Alert.alert('錯誤', '分享音訊檔案時出錯');
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
          {/* <TouchableOpacity onPress={shareAudioFile} style={[styles.iconButton]}>
            <IconSymbol name="arrow.down" size={20} color="black" />
          </TouchableOpacity> */}
        </View>
      )}
      <TextInput
            style={styles.textInput}
            multiline={true}
            value={wsMessage}
            onChangeText={setWsMessage} // 允許使用者編輯
          />
      <Text style={styles.backgroundNote}>
        {isRecording ? "錄音將在背景繼續進行" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  textInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 10,
    marginTop: 10,
    height: 100, // 設定高度
    width: '95%', // 設定寬度
  },
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
    width: 40,
    height: 40,
    borderRadius: 25,
  },
  deleteButton: {
    backgroundColor: '#EA4335',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  buttonLabel: {
    marginTop: 8,
    fontSize: 14,
    color: '#333',
  },
  playbackContainer: {
    width: '100%',
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playControlsContainer: {
    alignItems: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '70%',
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
