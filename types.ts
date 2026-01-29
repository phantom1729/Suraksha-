
export type Gender = 'female' | 'male' | null;

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface Helpline {
  name: string;
  number: string;
  description: string;
}

export type ViewMode = 'onboarding' | 'chat' | 'voice';
