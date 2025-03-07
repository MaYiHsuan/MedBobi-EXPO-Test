export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WebSocketMessage {
  type: string;
  data: any;
}

interface WebSocketCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onError: (error: any) => void;
  onMessage: (data: any) => void;
}

export class WebSocketService {
  private static instance: WebSocketService;
  private socket: WebSocket | null = null;
  private url: string;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private statusListeners: ((status: WebSocketStatus) => void)[] = [];
  private messageListeners: ((message: any) => void)[] = [];
  private callbacks: WebSocketCallbacks | null = null;

  private constructor(url: string) {
    this.url = url;
  }

  public static getInstance(url: string = 'wss://medbobi-api.bdlai.net/v1/AI/audioInference/multilingual'): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService(url);
    }
    return WebSocketService.instance;
  }

  public setCallbacks(callbacks: { 
    onOpen: () => void; 
    onClose: () => void; 
    onError: (error: any) => void; 
    onMessage: (data: any) => void; 
  }): void {
    this.callbacks = callbacks;
    
    // 如果已經有狀態監聽器，移除它們以避免重複
    this.statusListeners = [];
    this.messageListeners = [];
    
    // 添加新的狀態監聽器
    this.addStatusListener((status: WebSocketStatus) => {
      if (status === 'connected' && this.callbacks?.onOpen) {
        this.callbacks.onOpen();
      } else if (status === 'disconnected' && this.callbacks?.onClose) {
        this.callbacks.onClose();
      } else if (status === 'error' && this.callbacks?.onError) {
        this.callbacks.onError(new Error('WebSocket connection error'));
      }
    });
    
    // 添加新的消息監聽器
    this.addMessageListener((message: any) => {
      if (this.callbacks?.onMessage) {
        this.callbacks.onMessage(message);
      }
    });
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
        // 如果已經連接或正在連接，直接返回
        if (this.socket.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          // 如果正在連接，等待連接完成
          const onOpen = () => {
            this.socket?.removeEventListener('open', onOpen);
            this.socket?.removeEventListener('error', onError);
            resolve();
          };
          
          const onError = (event: any) => {
            this.socket?.removeEventListener('open', onOpen);
            this.socket?.removeEventListener('error', onError);
            reject(new Error('WebSocket 連接失敗'));
          };
          
          this.socket.addEventListener('open', onOpen);
          this.socket.addEventListener('error', onError);
        }
        return;
      }
      
    try {
        this.socket = new WebSocket(this.url);
        
        this.socket.onopen = () => {
            console.log('WebSocket 已連接');
            this.callbacks?.onOpen?.();
            resolve();
        };
        
        this.socket.onclose = () => {
            console.log('WebSocket 已關閉');
            this.callbacks?.onClose?.();
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket 錯誤:', error);
            this.callbacks?.onError?.(error);
            reject(error);
        };
        
        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.callbacks?.onMessage?.(data);
            } catch (error) {
                console.error('解析 WebSocket 消息失敗:', error);
            }
        };
    } catch (error) {
        console.error('創建 WebSocket 失敗:', error);
        reject(error);
    }
    });
  }

  public sendAudioData(audioData: string | ArrayBuffer): boolean {
    if (!this.isConnected || !this.socket) {
      console.warn('WebSocket 未連接，無法發送音訊數據');
      return false;
    }

    try {
      // 直接發送二進制數據，不需要轉換為 JSON
      this.socket.send(audioData);
      return true;
    } catch (error) {
      console.error('發送音訊數據失敗:', error);
      return false;
    }
  }

  public sendMessage(message: WebSocketMessage | string): boolean {
    if (!this.isConnected || !this.socket) {
      console.warn('WebSocket 未連接，無法發送消息');
      return false;
    }

    try {
      if (typeof message === 'string') {
        this.socket.send(message);
      } else {
        this.socket.send(JSON.stringify(message));
      }
      return true;
    } catch (error) {
      console.error('發送消息失敗:', error);
      return false;
    }
  }

  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.isConnected = false;
    }
  }

  public isConnectedToServer(): boolean {
    return this.isConnected;
  }

  public addStatusListener(listener: (status: WebSocketStatus) => void): void {
    this.statusListeners.push(listener);
  }

  public removeStatusListener(listener: (status: WebSocketStatus) => void): void {
    this.statusListeners = this.statusListeners.filter(l => l !== listener);
  }

  public addMessageListener(listener: (message: any) => void): void {
    this.messageListeners.push(listener);
  }

  public removeMessageListener(listener: (message: any) => void): void {
    this.messageListeners = this.messageListeners.filter(l => l !== listener);
  }

  private notifyStatusChange(status: WebSocketStatus): void {
    this.statusListeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('通知狀態變化時出錯:', error);
      }
    });
  }

  private notifyMessageReceived(message: any): void {
    this.messageListeners.forEach(listener => {
      try {
        listener(message);
      } catch (error) {
        console.error('通知消息接收時出錯:', error);
      }
    });
  }
}

export default WebSocketService.getInstance();
