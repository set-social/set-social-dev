import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@env';
import type { Database } from '../../types/database';

const REQUEST_TIMEOUT_MS = 15_000;
// chat-coach runs a multi-turn tool-calling loop against Claude — each tool
// call (or an attached food photo) is a full extra round-trip, so a single
// invocation can legitimately take longer than the default timeout above
// even when nothing is wrong. Generous but still bounded, rather than
// exempt entirely, so a truly hung request eventually surfaces an error
// instead of leaving the chat stuck "sending" forever.
const CHAT_COACH_TIMEOUT_MS = 60_000;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function timeoutMsFor(input: Parameters<typeof fetch>[0]): number {
  return requestUrl(input).includes('/functions/v1/chat-coach') ? CHAT_COACH_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

// React Native's fetch can stall indefinitely on a degraded connection (never
// resolving or rejecting), which otherwise leaves any in-flight mutation's
// `isPending` stuck `true` forever with no error surfaced.
function fetchWithTimeout(...[input, init]: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMsFor(input));
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
