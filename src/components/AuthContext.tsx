'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { get_current_account, logout } from '@/app/actions';
import { LoginDialog } from './LoginDialog';

interface Account {
  email: string;
}

interface AuthContextValue {
  account: Account | null;
  openLogin: () => void;
  logout: () => void;
  refreshAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  account: null,
  openLogin: () => {},
  logout: () => {},
  refreshAccount: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [account, setAccount] = useState<Account | null>(null);
  const [dialog_open, setDialogOpen] = useState(false);

  useEffect(() => {
    get_current_account().then((result) => {
      setAccount(result);
    });
  }, []);

  const refresh_account = useCallback(async () => {
    const result = await get_current_account();
    setAccount(result);
  }, []);

  const open_login = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handle_logout = useCallback(() => {
    logout().then(() => {
      window.location.reload();
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        account,
        openLogin: open_login,
        logout: handle_logout,
        refreshAccount: refresh_account,
      }}
    >
      {children}
      <LoginDialog
        open={dialog_open}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => {
          setDialogOpen(false);
          window.location.reload();
        }}
      />
    </AuthContext.Provider>
  );
};
