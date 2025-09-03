// Fixed auth.ts - Updated authentication service
import { apiRequest } from "./queryClient";

export interface User {
  id: string;
  email: string;
  username: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupCredentials {
  email: string;
  username: string;
  password: string;
}

// JWT payload decode function (client-side - no secret needed)
function decodeJWT(token: string) {
  try {
    const payload = token.split('.')[1];
    // Add padding if needed for base64 decoding
    const paddedPayload = payload + '==='.slice(0, (4 - payload.length % 4) % 4);
    const decoded = JSON.parse(atob(paddedPayload));
    return decoded;
  } catch (error) {
    console.error('Failed to decode JWT payload:', error);
    return null;
  }
}

class AuthService {
  private static instance: AuthService;
  private token: string | null = null;
  private user: User | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.initializeFromStorage();
    }
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private initializeFromStorage(): void {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (savedToken && savedUser) {
      try {
        // Verify token is not expired
        const decoded = decodeJWT(savedToken);
        if (decoded && decoded.exp && decoded.exp * 1000 > Date.now()) {
          this.token = savedToken;
          this.user = JSON.parse(savedUser);
        } else {
          // Token expired, clear storage
          console.log('Token expired, clearing storage');
          this.clearStorage();
        }
      } catch (error) {
        console.error('Error validating stored auth:', error);
        this.clearStorage();
      }
    }
  }

  private clearStorage(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    this.token = null;
    this.user = null;
  }

  public async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiRequest('POST', '/api/auth/login', credentials);
    const data: AuthResponse = await response.json();

    this.setAuth(data.user, data.token);
    return data;
  }

  public async signup(credentials: SignupCredentials): Promise<AuthResponse> {
    const response = await apiRequest('POST', '/api/auth/signup', credentials);
    const data: AuthResponse = await response.json();

    this.setAuth(data.user, data.token);
    return data;
  }

  public async getCurrentUser(): Promise<User | null> {
    if (!this.token) return null;

    try {
      const response = await apiRequest('GET', '/api/auth/me');
      const user: User = await response.json();
      this.user = user;
      
      // Update stored user data
      if (typeof window !== 'undefined') {
        localStorage.setItem('user', JSON.stringify(user));
      }
      
      return user;
    } catch (error) {
      console.error('Failed to get current user:', error);
      this.logout();
      return null;
    }
  }

  public logout(): void {
    this.clearStorage();
  }

  public getToken(): string | null {
    return this.token;
  }

  public getUser(): User | null {
    return this.user;
  }

  public isAuthenticated(): boolean {
    const hasAuth = !!this.token && !!this.user;
    
    // Additional check for token expiration
    if (hasAuth && this.token) {
      const decoded = decodeJWT(this.token);
      if (decoded && decoded.exp && decoded.exp * 1000 <= Date.now()) {
        console.log('Token expired during check, clearing auth');
        this.clearStorage();
        return false;
      }
    }
    
    return hasAuth;
  }

  private setAuth(user: User, token: string): void {
    this.user = user;
    this.token = token;

    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }
    
    console.log('Auth set successfully for user:', user.username);
  }

  // FIXED: Return proper Bearer token format for HTTP requests
  public getAuthHeader(): string {
    return this.token ? `Bearer ${this.token}` : '';
  }

  // New method: Get raw token for WebSocket connections
  public getRawToken(): string | null {
    return this.token;
  }
}

export const authService = AuthService.getInstance();

// useAuth.ts - Enhanced with better error handling
import { useState, useEffect } from 'react';

export function useAuth() {
  const [user, setUser] = useState<User | null>(authService.getUser());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      
      // Check if we have valid auth from storage
      if (authService.isAuthenticated()) {
        const currentUser = authService.getUser();
        setUser(currentUser);
        console.log('Auth initialized from storage for user:', currentUser?.username);
      } else {
        setUser(null);
        console.log('No valid auth found in storage');
      }
      
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (credentials: LoginCredentials): Promise<AuthResponse> => {
    try {
      const result = await authService.login(credentials);
      setUser(result.user);
      console.log('Login successful for user:', result.user.username);
      return result;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const signup = async (credentials: SignupCredentials): Promise<AuthResponse> => {
    try {
      const result = await authService.signup(credentials);
      setUser(result.user);
      console.log('Signup successful for user:', result.user.username);
      return result;
    } catch (error) {
      console.error('Signup failed:', error);
      throw error;
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
    console.log('User logged out');
  };

  return {
    user,
    isLoading,
    isAuthenticated: authService.isAuthenticated(),
    login,
    signup,
    logout,
    token: authService.getRawToken() // Use raw token for WebSocket connections
  };
}