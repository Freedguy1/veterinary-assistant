
export enum AppView {
  SUMMARIZER = 'summarizer',
  CHAT = 'chat',
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}
