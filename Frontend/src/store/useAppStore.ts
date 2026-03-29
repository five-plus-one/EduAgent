import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  department: string;
}

interface AppState {
  user: User | null;
  activeSessionId: string | null;
  theme: 'light' | 'dark';
  setActiveSession: (id: string) => void;
  setUser: (user: User) => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: {
    id: 'u_1001',
    name: '王老师',
    department: '物理系'
  },
  activeSessionId: null,
  theme: 'light',
  setActiveSession: (id: string) => set({ activeSessionId: id }),
  setUser: (user: User) => set({ user }),
  toggleTheme: () => set((state) => ({ 
    theme: state.theme === 'light' ? 'dark' : 'light' 
  })),
}));
