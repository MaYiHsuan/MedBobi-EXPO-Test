import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, Alert, Platform, StyleSheet, AppState, AppStateStatus, Switch, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { IconSymbol } from '@/components/ui/IconSymbol';
import AudioRecordManager from '@/services/AudioRecordManager';
import NotificationService from '@/services/NotificationService';
import WebSocketService, { WebSocketStatus } from '@/services/WebSocketService';

export default function AudioRecorderScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [recognizedText, setRecognizedText] = useState('');
  const [webSocketStatus, setWebSocketStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [useWebSocket, setUseWebSocket] = useState(true);
  
  const scrollViewRef = useRef<ScrollView>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);
  
  // 初始化 AudioRecordManager 和 WebSocket
  useEffect(() => {
    if (isInitializedRef.current) return;
    
    isInitializedRef.current = true;
    
    // 初始化音訊管理器
    AudioRecordManager.initialize({
      onRecordingStatusChange: (status) => {
        console.log("錄音狀態變更:", status);
        setIsRecording(status.isRecording);
        
        if (status.isRecording) {
          // 開始錄音計時器
          startRecordingTimer();
          
          // 如果啟用 WebSocket，建立連接並開始傳輸
          if (useWebSocket && webSocketStatus !== 'connected') {
            connectWebSocket();
          }
        } else {
          // 停止錄音計時器
          stopRecordingTimer();
          
          // 如果啟用了 WebSocket，停止錄音時設置轉錄狀態為 true
          if (useWebSocket) {
            setIsTranscribing(true);
          }
        }
      },
      onPlaybackStatusChange: (status) => {
        setIsPlaying(status.isPlaying);
        setPlaybackProgress(status.currentPosition);
      },
      onRecordingAvailable: (available) => {
        setHasRecording(available);
        if (available) {
          const duration = AudioRecordManager.getAudioDuration();
          setAudioDuration(duration);
        } else {
          setAudioDuration(0);
          setPlaybackProgress(0);
        }
      },
      onRecordingData: (audioData) => {
        // 如果啟用 WebSocket 且已連接，發送音訊數據
        if (useWebSocket && webSocketStatus === 'connected' && isRecording) {
          WebSocketService.sendAudioData(audioData);
        }
      },
    });

    // 設置 WebSocket 回調
    WebSocketService.setCallbacks({
      onOpen: () => {
        console.log('WebSocket 已連接');
        setWebSocketStatus('connected');
      },
      onClose: () => {
        console.log('WebSocket 已關閉');
        setWebSocketStatus('disconnected');
      },
      onError: (error: any) => {
        console.error('WebSocket 錯誤:', error);
        setWebSocketStatus('error');
      },
      onMessage: (data: any) => {
        console.log('收到識別結果:', data);
        
        // 假設後端返回的是文字字符串
        if (typeof data === 'string') {
          setRecognizedText(prevText => {
            // 將新識別的文字添加到現有文字後面
            const newText = prevText ? `${prevText} ${data}` : data;
            
            // 使用 setTimeout 確保在狀態更新後滾動到底部
            setTimeout(() => {
              scrollViewRef.current?.scrollToEnd({ animated: true });
            }, 100);
            
            return newText;
          });
        }
        
        // 收到識別結果後，設置轉錄狀態為 false
        setIsTranscribing(false);
      }
    });
    
    // 組件卸載時清理
    return () => {
      stopRecordingTimer();
      disconnectWebSocket();
      AudioRecordManager.cleanup();
    };
  }, []); // 移除依賴項，只在組件掛載時執行一次
  
  // 監聽 useWebSocket 變化
  useEffect(() => {
    if (useWebSocket) {
      // 如果啟用 WebSocket 且正在錄音，建立連接
      if (isRecording && webSocketStatus === 'disconnected') {
        connectWebSocket();
      }
    } else {
      // 如果禁用 WebSocket，關閉連接
      disconnectWebSocket();
    }
  }, [useWebSocket, isRecording, webSocketStatus]);

  const startRecordingTimer = () => {
    setRecordingDuration(0);
    stopRecordingTimer();
    
    recordingTimerRef.current = setInterval(() => {
      setRecordingDuration(prev => prev + 1);
    }, 1000);
  };

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const connectWebSocket = async (): Promise<boolean> => {
    if (webSocketStatus === 'disconnected' || webSocketStatus === 'error') {
      console.log('嘗試連接 WebSocket...');
      setWebSocketStatus('connecting');
      try {
        await WebSocketService.connect();
        console.log('WebSocket 連接成功');
        setWebSocketStatus('connected');
        return true;
      } catch (error) {
        console.error('WebSocket 連接失敗:', error);
        setWebSocketStatus('error');
        return false;
      }
    }
    return webSocketStatus === 'connected';
  };

  const startRecording = async () => {
    console.log('嘗試開始錄音...');
    
    // 清除之前的識別結果
    if (useWebSocket) {
      setRecognizedText('');
      
      // 如果啟用 WebSocket，確保已連接
      if (webSocketStatus !== 'connected') {
        if (webSocketStatus === 'connecting') {
          Alert.alert('請稍候', 'WebSocket 正在連接中，請等待連接完成後再試。');
          return;
        }
        
        // 嘗試連接 WebSocket
        const connected = await connectWebSocket();
        if (!connected) {
          Alert.alert('連接錯誤', '無法連接到語音識別服務，請稍後再試。');
          return;
        }
      }
    }
    
    // 開始錄音
    try {
      // 使用 useWebSocket 參數告訴 AudioRecordManager 是否需要處理 WebSocket 數據
      const success = await AudioRecordManager.startRecording(useWebSocket);
      if (!success) {
        Alert.alert('錯誤', '無法開始錄音');
      }
      console.log('開始錄音結果:', success);
    } catch (error) {
      console.error('開始錄音失敗:', error);
      Alert.alert('錯誤', '無法開始錄音。請確保已授予麥克風權限。');
    }
  };

  const stopRecording = async () => {
    console.log('嘗試停止錄音...');
    try {
      await AudioRecordManager.stopRecording();
      console.log('錄音已停止');
    } catch (error) {
      console.error('停止錄音失敗:', error);
    }
  };

  const playRecording = () => {
    AudioRecordManager.playRecording();
  };

  const stopPlayback = () => {
    AudioRecordManager.stopPlayback();
  };

  const seekToPosition = (value: number) => {
    AudioRecordManager.seekToPosition(value);
  };

  const cleanupRecording = () => {
    AudioRecordManager.cleanupRecording();
    setRecognizedText('');
  };

  // 格式化時間為 mm:ss 格式
  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const getWebSocketStatusText = () => {
    switch (webSocketStatus) {
      case 'connecting':
        return '連接中...';
      case 'connected':
        return '已連接';
      case 'disconnected':
        return '未連接';
      case 'error':
        return '連接錯誤';
      default:
        return '未知狀態';
    }
  };

  const getWebSocketStatusColor = () => {
    switch (webSocketStatus) {
      case 'connected':
        return '#34A853';
      case 'connecting':
        return '#FBBC05';
      case 'error':
        return '#EA4335';
      default:
        return '#9AA0A6';
    }
  };

  const disconnectWebSocket = () => {
    if (webSocketStatus === 'connected') {
      WebSocketService.disconnect();
    }
  };

  const handleRecordButtonPress = async () => {
    console.log('錄音按鈕被按下，當前錄音狀態:', isRecording);
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
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
      
      {useWebSocket && (
        <View style={styles.webSocketStatusContainer}>
          <Text style={styles.webSocketStatusLabel}>WebSocket 狀態:</Text>
          <View style={[styles.statusIndicator, { backgroundColor: getWebSocketStatusColor() }]} />
          <Text style={styles.webSocketStatusText}>{getWebSocketStatusText()}</Text>
        </View>
      )}
      
      <View style={styles.webSocketToggleContainer}>
        <Text style={styles.webSocketToggleLabel}>啟用即時語音識別:</Text>
        <Switch
          value={useWebSocket}
          onValueChange={setUseWebSocket}
          disabled={isRecording}
          trackColor={{ false: '#767577', true: '#81b0ff' }}
          thumbColor={useWebSocket ? '#4285F4' : '#f4f3f4'}
        />
      </View>
      
      <View style={styles.recordButtonContainer}>
      <TouchableOpacity 
        style={[
          styles.iconButton, 
          isRecording ? styles.recordingButton : styles.recordButton,
          (useWebSocket && webSocketStatus === 'connecting') ? styles.disabledButton : {}
        ]}
        onPress={handleRecordButtonPress}
        disabled={isPlaying || (useWebSocket && webSocketStatus === 'connecting')}
      >
        <IconSymbol 
          name={isRecording ? "stop" : "mic"} 
          size={30} 
          color={(useWebSocket && webSocketStatus === 'connecting') ? "#999" : "white"} 
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
      
      {/* 識別結果顯示區域 - 始終顯示 */}
      <View style={styles.recognizedTextContainer}>
        <View style={styles.recognizedTextHeader}>
          <Text style={styles.recognizedTextTitle}>識別結果:</Text>
          {isTranscribing && (
            <View style={styles.transcribingIndicator}>
              <Text style={styles.transcribingText}>識別中...</Text>
            </View>
          )}
        </View>
        <ScrollView 
          ref={scrollViewRef}
          style={styles.recognizedTextBox}
          contentContainerStyle={styles.recognizedTextContent}
        >
          <Text style={styles.recognizedTextValue}>
            {recognizedText || '等待開始錄音...'}
          </Text>
        </ScrollView>
      </View>
      
      <Text style={styles.backgroundNote}>
        {isRecording ? "錄音將在背景繼續進行" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disabledButton: {
    backgroundColor: '#cccccc',
    opacity: 0.7,
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
    marginBottom: 20,
    color: '#333',
    fontWeight: '500',
  },
  webSocketStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  webSocketStatusLabel: {
    fontSize: 14,
    color: '#555',
    marginRight: 8,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 5,
  },
  webSocketStatusText: {
    fontSize: 14,
    color: '#555',
  },
  webSocketToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  webSocketToggleLabel: {
    fontSize: 14,
    color: '#555',
    marginRight: 10,
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
  recognizedTextContainer: {
    width: '100%',
    marginTop: 20,
    padding: 10,
    maxHeight: 200,
  },
  recognizedTextHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recognizedTextTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  transcribingIndicator: {
    backgroundColor: '#FBBC05',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  transcribingText: {
    fontSize: 12,
    color: '#333',
  },
  recognizedTextBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    maxHeight: 150,
  },
  recognizedTextContent: {
    paddingBottom: 10,
  },
  recognizedTextValue: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  backgroundNote: {
    marginTop: 20,
    color: '#666',
    fontStyle: 'italic',
  }
});
