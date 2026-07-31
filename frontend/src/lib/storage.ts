import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const KEY = "saltbread_auth_token";
const USER_KEY = "saltbread_auth_user";

async function set(k: string, v: string | null) {
  if (Platform.OS === "web") {
    if (v == null) await AsyncStorage.removeItem(k);
    else await AsyncStorage.setItem(k, v);
    return;
  }
  if (v == null) await SecureStore.deleteItemAsync(k);
  else await SecureStore.setItemAsync(k, v);
}

async function get(k: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(k);
  return SecureStore.getItemAsync(k);
}

export const getToken = () => get(KEY);
export const setToken = (v: string | null) => set(KEY, v);
export const getUser = async () => {
  const raw = await get(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};
export const setUser = (u: any | null) => set(USER_KEY, u ? JSON.stringify(u) : null);
