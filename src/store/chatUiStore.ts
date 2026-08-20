import { create } from 'zustand';

type ChatUiState = {
  hasUnread: boolean;
  streamingBuffer: string;
  setHasUnread: (value: boolean) => void;
  appendToken: (token: string) => void;
  resetStreamingBuffer: () => void;
};

export const useChatUiStore = create<ChatUiState>(set => ({
  hasUnread: false,
  streamingBuffer: '',
  setHasUnread: value => set({ hasUnread: value }),
  appendToken: token => set(state => ({ streamingBuffer: state.streamingBuffer + token })),
  resetStreamingBuffer: () => set({ streamingBuffer: '' }),
}));
