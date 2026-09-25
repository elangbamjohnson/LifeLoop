export interface User {
  id: string;
  email: string;
  isAdmin?: boolean;
  accountStatus?: string;
  authProvider?: string;
}

