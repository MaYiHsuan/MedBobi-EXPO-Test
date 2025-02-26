import { useState, useEffect } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { View, Button, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';


const BACKGROUND_RECORDING_TASK = 'background-recording';
const RECORDING_NOTIFICATION_ID = 'recording-notification';

// 設定通知處理方式
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
    }),
});

// 註冊背景任務
TaskManager.defineTask(BACKGROUND_RECORDING_TASK, async () => {
  return BackgroundFetch.BackgroundFetchResult.NewData;
});

async function registerBackgroundTask() {
  try {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_RECORDING_TASK, {
          minimumInterval: 1,
          stopOnTerminate: false,
          startOnBoot: true,
      });
  } catch (error) {
      console.error('註冊背景任務失敗:', error);
  }
}

export default function RecordingScreen() {
    const [recording, setRecording] = useState<Audio.Recording | null>(null);
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingUri, setRecordingUri] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [position, setPosition] = useState(0);
    const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null);

    // 請求通知權限
    async function requestNotificationPermissions() {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
          alert('需要通知權限來顯示錄音狀態！');
          return false;
      }
      return true;
    }

    // 創建錄音通知
    async function createRecordingNotification() {
      await Notifications.setNotificationChannelAsync('recording', {
          name: '錄音通知',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
      });
    }
    // 更新錄音時間通知
    async function updateRecordingNotification() {
      if (!recordingStartTime) return;

      const elapsed = Math.floor((Date.now() - recordingStartTime.getTime()) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      // 更新現有通知的內容
    await Notifications.setNotificationHandler({
      handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
          priority: Notifications.AndroidNotificationPriority.HIGH,
      }),
  });

  await Notifications.scheduleNotificationAsync({
      content: {
          title: '正在錄音中',
          body: `錄音時間: ${timeString}`,
          data: { type: 'recording' },
          sticky: true,
          autoDismiss: false,
      },
      identifier: RECORDING_NOTIFICATION_ID,
      trigger: null,
  });
    }

        //初始化
        useEffect(() => {
            const init = async () => {
                try {
                  await Audio.setAudioModeAsync({
                    allowsRecordingIOS: true,
                    playsInSilentModeIOS: true,staysActiveInBackground: true, // 允許背景播放
                    interruptionModeIOS: 1, // 防止其他應用程式打斷
                    shouldDuckAndroid: true, // 其他應用播放聲音時降低音量
                    interruptionModeAndroid: 1,
                    playThroughEarpieceAndroid: false
                });

                await registerBackgroundTask();
                await requestNotificationPermissions();
                    // 創建通知頻道（僅 Android 需要）
                    if (Platform.OS === 'android') {
                        await createRecordingNotification();
                    }
                } catch (error) {
                    console.error('初始化失敗:', error);
                }
            };

              init();

              //清理值
              return () => {
                const cleanup = async () => {
                  if (recording) {
                      await recording.stopAndUnloadAsync();
                  }
                  if (sound) {
                      await sound.unloadAsync();
                  }
                  await BackgroundFetch.unregisterTaskAsync(BACKGROUND_RECORDING_TASK);
                  await Notifications.dismissNotificationAsync(RECORDING_NOTIFICATION_ID);
              };
              cleanup().catch(console.error);
          };
        }, []);

        // 更新錄音時間
        useEffect(() => {
          let interval: NodeJS.Timeout;
          if (isRecording && recordingStartTime) {
              // 立即更新一次
        updateRecordingNotification();
        // 每秒更新一次
        interval = setInterval(updateRecordingNotification, 1000);
          }
          return () => {
              if (interval) {
                  clearInterval(interval);
              }
          };
      }, [isRecording, recordingStartTime]);

        // 格式化時間
        const formatTime = (milliseconds: number) => {
          const totalSeconds = Math.floor(milliseconds / 1000);
          const minutes = Math.floor(totalSeconds / 60);
          const seconds = totalSeconds % 60;
          return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      };

      useKeepAwake();


    //錄音按鈕
    const handleRecordPress = async () => {
      try {
        // 只在用戶點擊錄音按鈕時才請求權限
        const { status } = await Audio.requestPermissionsAsync();
        
        if (status === 'granted') {
          const { recording } = await Audio.Recording.createAsync(
              Audio.RecordingOptionsPresets.HIGH_QUALITY,
              (status) => {
                  // 錄音狀態更新回調
                  console.log('Recording status:', status);
              },
              1000 // 更新間隔（毫秒）
          );
          setRecording(recording);
          setIsRecording(true);
          setRecordingStartTime(new Date());

          // 創建持續性通知
          if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('recording', {
                name: '錄音通知',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
                lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
                showBadge: true,
                enableVibrate: false,
                enableLights: false,
            });
        }

          await Notifications.scheduleNotificationAsync({
            content: {
                title: '開始錄音',
                body: '錄音已開始',
                data: { type: 'recording' },
            },
            identifier: RECORDING_NOTIFICATION_ID,
            trigger: {
                    channelId: 'recording',
                    seconds: 1,
                    repeats: true // 設置為重複通知
                }
        });
      } else {
          alert('需要麥克風權限才能錄音');
      }
      } catch (error) {
          console.error('錄音失敗:', error);
          alert('錄音失敗，請檢查麥克風權限');
      }
    };

    //暫停錄音
    const stopRecording = async () => {
        if (!recording) 
            return;
        try {
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            setRecordingUri(uri || null);
            setIsRecording(false);
            setRecording(null);
            setRecordingStartTime(null);

            await Notifications.dismissAllNotificationsAsync();

            // 顯示錄音完成通知
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: '錄音完成',
                    body: '您的錄音已保存',
                    data: { type: 'recording-complete' },
                },
                trigger: null,
            });
          } catch (error) {
            console.error('停止錄音失敗:', error);
          }
    };

    // 更新播放進度
      const updatePlaybackStatus = async (status: AVPlaybackStatus) => {
        if (status.isLoaded) {
          setPosition(status.positionMillis);
          setDuration(status.durationMillis || 0);
          setIsPlaying(status.isPlaying);
      
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPosition(0);
          }
        }
      };

    //播放音頻
    const playSound = async () => {
        if (!recordingUri) return;
    
        try {
          if (sound) {
            const status = await sound.getStatusAsync();
            if (status.isLoaded) {
                if (status.isPlaying) {
                    await sound.pauseAsync();
                } else {
                    await sound.playAsync();
                }
                return;
            }
          }
          const { sound: newSound } = await Audio.Sound.createAsync(
            { uri: recordingUri },
            { progressUpdateIntervalMillis: 100 },
            updatePlaybackStatus
          );
          
          setSound(newSound);
          await newSound.playAsync();
        } catch (error) {
          console.error('播放錄音失敗:', error);
          alert('播放錄音時發生錯誤');
        }
    };

     // 處理進度條變化
     const onSeekSliderValueChange = async (value: number) => {
      if (sound) {
        try {
            await sound.setPositionAsync(Math.floor(value));
        } catch (error) {
            console.error('設置播放位置失敗:', error);
        }
    }
  };

    //回傳值
    return (
        <View style={styles.container}>
            <Text style={styles.title}>
                {isRecording ? '正在錄音...' : '準備錄音'}   
            </Text>

            <View style={styles.buttonContainer}>
                {!isRecording ? (
                    <Button title="開始錄音" onPress={handleRecordPress} color="#4CAF50"/>
                ) : (
                    <Button title="停止錄音" onPress={stopRecording} color="#f44336"/>

                )}
            </View>
            
            {recordingUri && (
                <View style={styles.playbackContainer}>
                    <TouchableOpacity 
                        style={styles.playButton} 
                        onPress={playSound}
                    >
                        {isPlaying ? (
                            <Ionicons name="pause" size={24} color="#2196F3" />
                        ) : (
                          <Ionicons name="play" size={24} color="#2196F3" />
                        )}
                    </TouchableOpacity>

                    <View style={styles.sliderContainer}>
                        <Slider
                            style={styles.slider}
                            minimumValue={0}
                            maximumValue={duration}
                            value={position}
                            onSlidingComplete={onSeekSliderValueChange}
                            minimumTrackTintColor="#2196F3"
                            maximumTrackTintColor="#000000"
                        />
                        <View style={styles.timeContainer}>
                            <Text>{formatTime(position)}</Text>
                            <Text>{formatTime(duration)}</Text>
                        </View>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    title: {
        fontSize: 24,
        marginBottom: 30,
    },
    buttonContainer: {
        marginVertical: 10,
        minWidth: 200,
    },
    playbackContainer: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      marginTop: 20,
  },
  playButton: {
      padding: 10,
  },
  sliderContainer: {
      flex: 1,
      marginLeft: 10,
  },
  slider: {
      width: '100%',
  },
  timeContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 5,
  },
});