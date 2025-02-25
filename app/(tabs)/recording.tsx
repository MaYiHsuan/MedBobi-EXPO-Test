import { useState, useEffect } from 'react';
import { Audio } from 'expo-av';
import { View, Button, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Slider from '@react-native-community/slider';
// import { Pause, Play } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';


export default function RecordingScreen() {
    const [recording, setRecording] = useState<Audio.Recording | null>(null);
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingUri, setRecordingUri] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [position, setPosition] = useState(0);

    //初始化
    useEffect(() => {
        const init = async () => {
            try {
              await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
              });
            } catch (error) {
              console.error('無法初始化音訊:', error);
            }
          };

          init();

          //清理值
          return () => {
            if (recording) {
              recording.stopAndUnloadAsync();
            }
            if (sound) {
              sound.unloadAsync();
            }
          };
    }, []);

    // 格式化時間
    const formatTime = (milliseconds: number) => {
      const totalSeconds = Math.floor(milliseconds / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };


    //錄音按鈕
    const handleRecordPress = async () => {
      try {
        // 只在用戶點擊錄音按鈕時才請求權限
        const { status } = await Audio.requestPermissionsAsync();
        
        if (status === 'granted') {
          const { recording } = await Audio.Recording.createAsync(
              Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          setRecording(recording);
          setIsRecording(true);
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
          } catch (error) {
            console.error('停止錄音失敗:', error);
          }
    };

    // 更新播放進度
    const updatePlaybackStatus = async (status: any) => {
      if (status.isLoaded) {
          setPosition(status.positionMillis);
          setDuration(status.durationMillis);
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
          await sound.setPositionAsync(value);
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