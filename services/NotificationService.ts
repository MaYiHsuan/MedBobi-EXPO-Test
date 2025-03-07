import PushNotification from 'react-native-push-notification';
import { Platform } from 'react-native';

export class NotificationService {
  private static isInitialized = false;
  
  public static init(): void {
    if (this.isInitialized) {
      return;
    }
    
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
    
    this.isInitialized = true;
  }
  
  public static showRecordingNotification(message: string): void {
    if (!this.isInitialized) {
      this.init();
    }
    
    PushNotification.localNotification({
      channelId: 'recording-channel',
      title: '錄音進行中',
      message: `已錄製 ${message}`,
      ongoing: true,
      autoCancel: false,
      id: 1001,
    });
  }
  
  public static updateRecordingNotification(message: string): void {
    if (!this.isInitialized) {
      this.init();
    }
    
    PushNotification.localNotification({
      channelId: 'recording-channel',
      title: '錄音進行中',
      message: `已錄製 ${message}`,
      ongoing: true,
      autoCancel: false,
      id: 1001,  // 使用相同的 ID 來更新同一個通知
    });
  }
  
    public static cancelRecordingNotification(): void {
        PushNotification.cancelLocalNotification('1001');
    }

    public static cancelAllNotifications(): void {
        PushNotification.cancelAllLocalNotifications();
    }
}

export default NotificationService;
