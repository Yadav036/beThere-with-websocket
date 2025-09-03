import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Helper function to get authentication headers
function getAuthHeaders(includeContentType: boolean = false): HeadersInit {
  const token = localStorage.getItem('token');
  const headers: HeadersInit = {};
  
  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }
  
  if (token) {
    headers["Authorization"] = token;
  }
  
  return headers;
}

// Helper function to handle authentication failures
function handleAuthFailure() {
  console.log('❌ Authentication failed, clearing token');
  localStorage.removeItem('token');
  // Redirect to login page
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = getAuthHeaders(!!data);

  console.log(`🔍 Making ${method} request to ${url}`, {
    hasToken: !!localStorage.getItem('token'),
    hasData: !!data
  });

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  console.log(`📡 Response status: ${res.status}`);

  // Handle authentication failures specifically
  if (res.status === 401) {
    handleAuthFailure();
    throw new Error('Authentication failed');
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw" | "redirect";

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const headers = getAuthHeaders();

    console.log(`🔍 Query function fetching: ${url}`, {
      hasToken: !!localStorage.getItem('token')
    });

    const res = await fetch(url, {
      headers,
      credentials: "include",
    });

    console.log(`📡 Query response status: ${res.status}`);

    // Handle 401 based on the specified behavior
    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        console.log('⚠️ Unauthorized request, returning null');
        return null;
      } else if (unauthorizedBehavior === "redirect") {
        console.log('⚠️ Unauthorized request, redirecting to login');
        handleAuthFailure();
        return null;
      }
      // Default: throw
      console.log('⚠️ Unauthorized request, throwing error');
      handleAuthFailure();
      throw new Error('Authentication failed');
    }

    await throwIfResNotOk(res);
    const data = await res.json();
    console.log(`✅ Query successful for ${url}`);
    return data;
  };

// Enhanced query client with better error handling
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "redirect" }), // Changed to redirect on 401
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes instead of Infinity for better UX
      retry: (failureCount, error) => {
        // Don't retry on authentication errors
        if (error instanceof Error && error.message.includes('Authentication failed')) {
          return false;
        }
        // Don't retry on 4xx errors (client errors)
        if (error instanceof Error && error.message.match(/^4\d\d:/)) {
          return false;
        }
        // Retry up to 2 times for other errors
        return failureCount < 2;
      },
    },
    mutations: {
      retry: (failureCount, error) => {
        // Don't retry on authentication errors
        if (error instanceof Error && error.message.includes('Authentication failed')) {
          return false;
        }
        // Don't retry on 4xx errors (client errors)
        if (error instanceof Error && error.message.match(/^4\d\d:/)) {
          return false;
        }
        // Retry once for server errors
        return failureCount < 1;
      },
    },
  },
});

// Utility functions for common API operations
export const apiUtils = {
  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!localStorage.getItem('token');
  },

  // Get current auth token
  getToken(): string | null {
    return localStorage.getItem('token');
  },

  // Clear authentication
  clearAuth(): void {
    localStorage.removeItem('token');
  },

  // Set authentication token
  setToken(token: string): void {
    localStorage.setItem('token', token);
  },

  // Make authenticated GET request
  async get<T>(url: string): Promise<T> {
    const response = await apiRequest('GET', url);
    return response.json();
  },

  // Make authenticated POST request
  async post<T>(url: string, data?: unknown): Promise<T> {
    const response = await apiRequest('POST', url, data);
    return response.json();
  },

  // Make authenticated PUT request
  async put<T>(url: string, data?: unknown): Promise<T> {
    const response = await apiRequest('PUT', url, data);
    return response.json();
  },

  // Make authenticated DELETE request
  async delete<T>(url: string): Promise<T> {
    const response = await apiRequest('DELETE', url);
    return response.json();
  },
};

// Export query function variants for different auth behaviors
export const getQueryFnThrow = getQueryFn({ on401: "throw" });
export const getQueryFnReturnNull = getQueryFn({ on401: "returnNull" });
export const getQueryFnRedirect = getQueryFn({ on401: "redirect" });