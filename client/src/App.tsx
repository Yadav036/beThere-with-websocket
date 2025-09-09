import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "./lib/auth";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import EventPage from "@/pages/event/[id]";

// Protected Route wrapper component
function ProtectedRoute({ component: Component, ...props }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-2xl font-black text-primary">📸 LOADING...</div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  
  return <Component {...props} />;
}

// Public Route wrapper component (redirects to home if authenticated)
function PublicRoute({ component: Component, ...props }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-2xl font-black text-primary">📸 LOADING...</div>
      </div>
    );
  }
  
  if (isAuthenticated) {
    return <Redirect to="/home" />;
  }
  
  return <Component {...props} />;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading only for the initial auth check
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-2xl font-black text-primary">📸 LOADING...</div>
      </div>
    );
  }

  return (
    <Switch>
      {/* Protected Routes */}
      <Route path="/home" component={(props) => (
        <ProtectedRoute component={Home} {...props} />
      )} />
      <Route path="/event/:id" component={(props) => (
        <ProtectedRoute component={EventPage} {...props} />
      )} />
      
      {/* Public Routes */}
      <Route path="/login" component={(props) => (
        <PublicRoute component={Login} {...props} />
      )} />
      <Route path="/signup" component={(props) => (
        <PublicRoute component={Signup} {...props} />
      )} />
      
      {/* Root redirect */}
      <Route exact path="/" component={() => (
        <Redirect to={isAuthenticated ? "/home" : "/login"} />
      )} />
      
      {/* 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;