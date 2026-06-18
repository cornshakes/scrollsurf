'use client';

import { createContext, useContext, useState, useRef, useMemo } from 'react';
import type { FeedItem } from '@/lib/db';

interface FeedContextValue {
  items: FeedItem[];
  setItems: React.Dispatch<React.SetStateAction<FeedItem[]>>;
  scrollTopRef: React.RefObject<number>;
}

const FeedContext = createContext<FeedContextValue | null>(null);

export const FeedProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const scrollTopRef = useRef<number>(0);

  const value = useMemo(() => ({ items, setItems, scrollTopRef }), [items]);

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
};

export const useFeed = (): FeedContextValue => {
  const ctx = useContext(FeedContext);
  if (!ctx) {
    throw new Error('useFeed must be used within a FeedProvider');
  }
  return ctx;
};
