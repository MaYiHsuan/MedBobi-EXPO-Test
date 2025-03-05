import React, { useState, useEffect } from 'react';
import { View, Button, Text, Alert, Platform, PermissionsAndroid } from 'react-native';
import AudioRecord from 'react-native-audio-record';
import type * as FileSystemType from 'expo-file-system';
import * as DevClient from 'expo-dev-client';

export default function AudioRecorderScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioFile, setAudioFile] = useState('');
  const [audioData, setAudioData] = useState('');
  const FileSystem = require('expo-file-system') as typeof FileSystemType;

  useEffect(() => {
    // 配置錄音選項
    const options = {
      sampleRate: 16000,  // 採樣率
      channels: 1,        // 通道數 (1 = 單聲道, 2 = 立體聲)
      bitsPerSample: 16,  // 位元深度
      audioSource: 6,     // Android only (see AudioSource)
      wavFile: 'test.wav' // 檔案名稱
    };

    AudioRecord.init(options);

    // 監聽錄音數據
    AudioRecord.on('data', data => {
      // 可以在這裡處理實時音頻數據
      setAudioData(prevData => prevData + data);
    });

    requestPermission();

    return () => {
      // 組件卸載時停止錄音
      if (isRecording) {
        AudioRecord.stop();
      }
    };
  }, []);

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
          console.log('未獲得所有權限');
        }
      } catch (err) {
        console.warn(err);
      }
    }
  };

  const startRecording = () => {
    setAudioData('');
    AudioRecord.start();
    setIsRecording(true);
    console.log('開始錄音');
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    
    const audioFile = await AudioRecord.stop();
    setAudioFile(audioFile);
    setIsRecording(false);
    console.log('錄音結束，文件保存在:', audioFile);
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <Text>錄音狀態: {isRecording ? '錄音中' : '未錄音'}</Text>
    {audioFile ? <Text>錄音文件: {audioFile}</Text> : null}
    
    <Button 
      title={isRecording ? "停止錄音" : "開始錄音"} 
      onPress={isRecording ? stopRecording : startRecording} 
    />
  </View>
  );
}
