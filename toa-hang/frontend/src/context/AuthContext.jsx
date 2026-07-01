import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'toahang_token';
const EXP_KEY   = 'toahang_token_exp';

function readStoredAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  const exp   = Number(localStorage.getItem(EXP_KEY) || 0);
  if (!token || !exp || Date.now() >= exp) return null;
  return { token, exp };
}

// Đọc token trực tiếp từ localStorage — dùng trong api.js (ngoài React tree)
export function getStoredToken() {
  return readStoredAuth()?.token || null;
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => readStoredAuth());

  const login = useCallback((token, expiresInSeconds) => {
    const exp = Date.now() + expiresInSeconds * 1000;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXP_KEY, String(exp));
    setAuth({ token, exp });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXP_KEY);
    setAuth(null);
  }, []);

  // Tự động logout khi token hết hạn (24h), kể cả khi tab đang mở sẵn
  useEffect(() => {
    if (!auth) return;
    const remaining = auth.exp - Date.now();
    if (remaining <= 0) {
      logout();
      return;
    }
    const timer = setTimeout(logout, remaining);
    return () => clearTimeout(timer);
  }, [auth, logout]);

  const value = {
    token: auth?.token || null,
    isAuthenticated: !!auth,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() phải được dùng bên trong <AuthProvider>');
  return ctx;
}
