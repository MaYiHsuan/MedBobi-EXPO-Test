import { Platform } from 'react-native';
import ForegroundServiceOriginal from 'react-native-foreground-service';

export class ForegroundService {
  private static isRunning = false;
  
  public static async startService(): Promise<void> {
    if (Platform.OS !== 'android' || this.isRunning) return;
    
    try {
      await ForegroundServiceOriginal.startService({
        id: 1244,
        title: '錄音進行中',
        message: '點擊返回應用',
        icon: 'ic_launcher',
      });
      this.isRunning = true;
    } catch (error) {
      console.error('啟動前台服務失敗:', error);
    }
  }
  
  public static stopService(): void {
    if (Platform.OS !== 'android' || !this.isRunning) return;
    
    try {
      ForegroundServiceOriginal.stopService();
      this.isRunning = false;
    } catch (error) {
      console.error('停止前台服務失敗:', error);
    }
  }
}

export default ForegroundService;
