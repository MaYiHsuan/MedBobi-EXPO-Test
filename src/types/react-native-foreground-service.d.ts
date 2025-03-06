declare module 'react-native-foreground-service' {
    interface NotificationConfig {
      id: number;
      title: string;
      message: string;
      icon?: string;
      button?: boolean;
      buttonText?: string;
      buttonOnPress?: string;
      setOnlyAlertOnce?: boolean;
      channelId?: string;
      channelName?: string;
      color?: string;
      visibility?: 'public' | 'private' | 'secret';
      importance?: 'default' | 'max' | 'high' | 'low' | 'min' | 'none' | 'unspecified';
      vibration?: boolean;
      sound?: boolean;
      number?: number;
      progress?: {
        max: number;
        current: number;
      };
    }
  
    interface ForegroundServiceStatic {
      startService(config: NotificationConfig): Promise<void>;
      stopService(): Promise<void>;
      createNotificationChannel(config: {
        id: string;
        name: string;
        description?: string;
        importance?: 'default' | 'max' | 'high' | 'low' | 'min' | 'none' | 'unspecified';
        enableVibration?: boolean;
        vibrationPattern?: number[];
      }): Promise<void>;
      updateNotification(config: NotificationConfig): Promise<void>;
      registerForegroundTask(taskName: string, task: () => void): void;
      unregisterForegroundTask(taskName: string): void;
    }
  
    const ForegroundService: ForegroundServiceStatic;
    export default ForegroundService;
  }
  