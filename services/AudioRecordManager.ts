import AudioRecord from 'react-native-audio-record';
import Sound from 'react-native-sound';
import { Platform } from 'react-native';
import RNFetchBlob from 'rn-fetch-blob';
import BackgroundTimer from 'react-native-background-timer';
import ForegroundService from 'react-native-foreground-service';
import NotificationService from './NotificationService';

// 啟用 Sound 庫的錯誤日誌
Sound.setCategory('PlayAndRecord', true);

interface RecordingOptions {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  wavFile: string;
}

interface AudioRecordManagerCallbacks {
  onRecordingStatusChange?: (status: { isRecording: boolean }) => void;
  onPlaybackStatusChange?: (status: { isPlaying: boolean; currentPosition: number }) => void;
  onRecordingAvailable?: (available: boolean) => void;
  onRecordingData?: (data: string) => void;
}

class AudioRecordManager {
  private static instance: AudioRecordManager;
  private isInitialized: boolean = false;
  private isRecording: boolean = false;
  private isPlaying: boolean = false;
  private hasRecording: boolean = false;
  private audioPath: string | null = null;
  private sound: Sound | null = null;
  private options: RecordingOptions | null = null;
  private recordingTimer: number | null = null;
  private playbackTimer: ReturnType<typeof setInterval> | null = null;
  private audioDuration: number = 0;
  private callbacks: AudioRecordManagerCallbacks = {};

  private constructor() {
    // 私有構造函數，防止直接實例化
  }

  public static getInstance(): AudioRecordManager {
    if (!AudioRecordManager.instance) {
      AudioRecordManager.instance = new AudioRecordManager();
    }
    return AudioRecordManager.instance;
  }

  public initialize(callbacks: AudioRecordManagerCallbacks): void {
    this.callbacks = callbacks;
    this.init().catch(error => console.error('初始化錄音管理器失敗:', error));
  }

  private async init(): Promise<void> {
    try {
      // 確保錄音目錄存在
      const dirPath = `${RNFetchBlob.fs.dirs.CacheDir}/audio_recordings`;
      await RNFetchBlob.fs.isDir(dirPath).then(exists => {
        if (!exists) {
          return RNFetchBlob.fs.mkdir(dirPath);
        }
      });
      
      // 生成唯一的檔案名
      const fileName = `recording_${new Date().getTime()}.wav`;
      const filePath = `${dirPath}/${fileName}`;
      
      // 初始化錄音選項
      const options = {
        sampleRate: 44100,  // 確保與播放器支持的採樣率一致
        channels: 1,        // 單聲道
        bitsPerSample: 16,  // 16位
        wavFile: filePath,  // WAV 檔案路徑
      };
      
      console.log('初始化錄音選項:', options);
      
      // 初始化錄音
      await AudioRecord.init(options);
      this.options = options;
      this.isInitialized = true;
      
      console.log('錄音系統初始化成功');
      return;
    } catch (error) {
      console.error('初始化錄音系統失敗:', error);
      throw error;
    }
  }

  public async startRecording(useWebSocket: boolean = false): Promise<boolean> {
    if (!this.isInitialized) {
      console.log('錄音系統未初始化，嘗試初始化...');
      await this.init();
    }

    if (this.isRecording) {
      console.log('已經在錄音中');
      return false;
    }

    try {
      console.log('開始錄音...');
      
      // 如果之前有錄音，先清理
      if (this.hasRecording) {
        this.cleanupRecording();
      }
      
      // 開始錄音
      AudioRecord.start();
      this.isRecording = true;
      
      // 通知錄音狀態變化
      if (this.callbacks.onRecordingStatusChange) {
        this.callbacks.onRecordingStatusChange({ isRecording: true });
      }
      
      // 如果需要將音訊數據發送到 WebSocket
      if (useWebSocket) {
        this.setupAudioDataListener();
      }
      
      // 在 Android 上啟動前台服務
      if (Platform.OS === 'android') {
        this.startForegroundService();
      }
      
      // 顯示錄音通知
      NotificationService.showRecordingNotification('');
      
      return true;
    } catch (error) {
      console.error('開始錄音失敗:', error);
      this.isRecording = false;
      return false;
    }
  }

  private setupAudioDataListener(): void {
    // 設置音訊數據監聽器
    AudioRecord.on('data', (data) => {
      if (this.isRecording && this.callbacks.onRecordingData) {
        this.callbacks.onRecordingData(data);
      }
    });
  }

  private startForegroundService(): void {
    // Android 前台服務配置
    const channelConfig = {
      id: 'recording_channel',
      name: '錄音服務',
      description: '保持錄音在背景運行',
      enableVibration: false,
      importance: 'high' as "high",
    };

    const notificationConfig = {
      channelId: 'recording_channel',
      id: 3456,
      title: '錄音進行中',
      text: '應用正在錄音...',
      message: '應用正在錄音...',
      icon: 'ic_launcher',
    };

    ForegroundService.createNotificationChannel(channelConfig);
    ForegroundService.startService(notificationConfig);
  }

  public async stopRecording(): Promise<string | undefined> {
    if (!this.isRecording) {
      console.log('沒有正在進行的錄音');
      return;
    }

    try {
      console.log('停止錄音...');
      
      // 停止錄音計時器
      if (this.recordingTimer) {
        BackgroundTimer.clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }
      
      // 獲取錄音數據
      const audioFile = await AudioRecord.stop();
      console.log('錄音已停止，檔案路徑:', audioFile);
      
      // 確保完全關閉檔案並釋放資源
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.audioPath = audioFile;
      this.hasRecording = true;
      this.isRecording = false;
      
      // 通知錄音狀態變化
      if (this.callbacks.onRecordingStatusChange) {
        this.callbacks.onRecordingStatusChange({ isRecording: false });
      }
      
      // 通知錄音可用
      if (this.callbacks.onRecordingAvailable) {
        this.callbacks.onRecordingAvailable(true);
      }
      
      // 獲取錄音檔案的時長
      this.getAudioFileDuration(audioFile);
      
      if (Platform.OS === 'android') {
        ForegroundService.stopService();
      }
      
      NotificationService.cancelRecordingNotification();
      
      return audioFile;
    } catch (error) {
      console.error('停止錄音失敗:', error);
      this.isRecording = false;
      if (this.callbacks.onRecordingStatusChange) {
        this.callbacks.onRecordingStatusChange({ isRecording: false });
      }
      throw error;
    }
  }

  private getAudioFileDuration(filePath: string): void {
    // 確保路徑格式正確
    const audioPath = Platform.select({
      ios: filePath.replace('file://', ''), // iOS 不需要 file:// 前綴
      android: !filePath.startsWith('file://') ? `file://${filePath}` : filePath,
      default: filePath
    });
    
    console.log('嘗試獲取音訊時長，路徑:', audioPath);
    
    // 添加延遲確保檔案已完全寫入
    setTimeout(() => {
      // 加載音訊檔案以獲取時長
      const sound = new Sound(audioPath, '', (error) => {
        if (error) {
          console.error('加載音訊檔案失敗:', error);
          // 嘗試使用備用方法獲取時長
          this.tryAlternativeGetDuration(filePath);
          return;
        }
        
        this.audioDuration = sound.getDuration();
        console.log('音訊時長:', this.audioDuration);
        
        // 釋放 Sound 實例，僅用於獲取時長
        sound.release();
      });
    }, 300); // 添加 300ms 延遲
  }

  private tryAlternativeGetDuration(filePath: string): void {
    console.log('嘗試備用方法獲取音訊時長');
    
    if (Platform.OS === 'ios') {
      // iOS 上使用原始路徑再試一次
      const rawPath = filePath.replace('file://', '');
      const sound = new Sound(rawPath, '', (error) => {
        if (error) {
          console.error('備用方法獲取音訊時長失敗:', error);
          this.audioDuration = 0; // 設置默認值
          return;
        }
        
        this.audioDuration = sound.getDuration();
        console.log('備用方法獲取音訊時長成功:', this.audioDuration);
        sound.release();
      });
    } else {
      // 設置一個默認值
      this.audioDuration = 0;
    }
  }

  public async playRecording(): Promise<void> {
    if (!this.hasRecording || !this.audioPath) {
      console.log('沒有可用的錄音');
      return;
    }

    try {
      if (this.isPlaying) {
        console.log('已經在播放中');
        return;
      }
      
      console.log('開始播放錄音:', this.audioPath);
      
      // 釋放之前的 Sound 實例
      if (this.sound) {
        this.sound.release();
        this.sound = null;
      }
      
      // 確保路徑格式正確
      const audioPath = Platform.select({
        ios: this.audioPath.replace('file://', ''), // iOS 不需要 file:// 前綴
        android: !this.audioPath.startsWith('file://') ? `file://${this.audioPath}` : this.audioPath,
        default: this.audioPath
      });
      
      console.log('使用播放路徑:', audioPath);
      
      // 重新加載音訊檔案
      const sound = new Sound(audioPath, '', (error) => {
        if (error) {
          console.error('加載音訊檔案失敗:', error);

          this.tryPlayWithAlternativePath();
          return;
        }
        
        console.log('音訊檔案加載成功，時長:', sound.getDuration());
        
        // 設置播放完成回調
        sound.setNumberOfLoops(0); // 不循環播放
        
        // 開始播放
        sound.play((success) => {
          console.log('播放完成，狀態:', success ? '成功' : '失敗');
          this.isPlaying = false;
          
          if (this.callbacks.onPlaybackStatusChange) {
            this.callbacks.onPlaybackStatusChange({ 
              isPlaying: false, 
              currentPosition: 0 
            });
          }
        });
        
        this.isPlaying = true;
        this.sound = sound;
        
        if (this.callbacks.onPlaybackStatusChange) {
          this.callbacks.onPlaybackStatusChange({ 
            isPlaying: true, 
            currentPosition: 0 
          });
        }
        
        // 設置播放進度更新計時器
        this.setupPlaybackProgressTimer();
      });
    } catch (error) {
      console.error('播放錄音失敗:', error);
    }
  }

  private tryPlayWithAlternativePath(): void {
    if (!this.audioPath) return;
    
    console.log('嘗試使用備用方法播放錄音');
    
    try {
      // 嘗試不同的路徑格式
      const altPath = Platform.OS === 'ios' 
        ? this.audioPath.replace('file://', '') // 移除 file:// 前綴
        : (this.audioPath.startsWith('file://') 
          ? this.audioPath.substring(7) // 移除 file:// 前綴
          : `file://${this.audioPath}`); // 添加 file:// 前綴
      
      console.log('嘗試備用路徑:', altPath);
      
      const sound = new Sound(altPath, '', (error) => {
        if (error) {
          console.error('備用方法播放失敗:', error);
          return;
        }
        
        sound.play((success) => {
          console.log('備用播放完成，狀態:', success ? '成功' : '失敗');
          this.isPlaying = false;
          
          if (this.callbacks.onPlaybackStatusChange) {
            this.callbacks.onPlaybackStatusChange({ 
              isPlaying: false, 
              currentPosition: 0 
            });
          }
        });
        
        this.isPlaying = true;
        this.sound = sound;
        
        if (this.callbacks.onPlaybackStatusChange) {
          this.callbacks.onPlaybackStatusChange({ 
            isPlaying: true, 
            currentPosition: 0 
          });
        }
        
        this.setupPlaybackProgressTimer();
      });
    } catch (error) {
      console.error('備用播放方法失敗:', error);
    }
  }

  private setupPlaybackProgressTimer(): void {
    // 清除之前的計時器
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    
    // 設置新的計時器，每100毫秒更新一次
    this.playbackTimer = setInterval(() => {
      if (this.sound && this.isPlaying) {
        this.sound.getCurrentTime((seconds) => {
          // 確保回調函數存在
          if (this.callbacks.onPlaybackStatusChange) {
            this.callbacks.onPlaybackStatusChange({
              isPlaying: true,
              currentPosition: seconds
            });
          }
        });
      } else {
        // 如果不再播放，清除計時器
        if (this.playbackTimer) {
          clearInterval(this.playbackTimer);
          this.playbackTimer = null;
        }
      }
    }, 100);
  }

  public stopPlayback(): void {
    if (this.sound && this.isPlaying) {
      this.sound.stop();
      this.isPlaying = false;
      
      if (this.playbackTimer) {
        clearInterval(this.playbackTimer);
        this.playbackTimer = null;
      }
      
      if (this.callbacks.onPlaybackStatusChange) {
        this.callbacks.onPlaybackStatusChange({
          isPlaying: false,
          currentPosition: 0
        });
      }
    }
  }

  public seekToPosition(position: number): void {
    if (this.sound) {
      this.sound.setCurrentTime(position);
      
      if (this.callbacks.onPlaybackStatusChange) {
        this.callbacks.onPlaybackStatusChange({
          isPlaying: this.isPlaying,
          currentPosition: position
        });
      }
    }
  }

  public cleanupRecording(): void {
    // 停止播放
    this.stopPlayback();
    
    // 釋放 Sound 實例
    if (this.sound) {
      this.sound.release();
      this.sound = null;
    }
    
    // 刪除錄音檔案
    if (this.audioPath) {
      RNFetchBlob.fs.unlink(this.audioPath)
        .then(() => {
          console.log('錄音檔案已刪除');
        })
        .catch(error => {
          console.error('刪除錄音檔案失敗:', error);
        });
    }
    
    this.hasRecording = false;
    this.audioPath = null;
    this.audioDuration = 0;
    
    // 重新初始化錄音系統
    this.init().catch(error => console.error('重新初始化錄音系統失敗:', error));
    
    // 通知錄音不可用
    if (this.callbacks.onRecordingAvailable) {
      this.callbacks.onRecordingAvailable(false);
    }
  }

  public getAudioDuration(): number {
    return this.audioDuration;
  }

  public cleanup(): void {
    this.stopRecording().catch(error => console.error('停止錄音失敗:', error));
    this.cleanupRecording();
    this.isInitialized = false;
  }
}

export default AudioRecordManager.getInstance();
