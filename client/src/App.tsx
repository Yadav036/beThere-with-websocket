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

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-2xl font-black text-primary">📸 LOADING...</div>
      </div>
    );
  }

  return (
  <Switch>
      {isAuthenticated ? (
        <>
          <Route path="/home" component={Home} />
          <Route path="/event/:id" component={EventPage} />
          <Route path="/login" component={() => <Redirect to="/home" />} />
          <Route path="/signup" component={() => <Redirect to="/home" />} />
          <Route exact path="/" component={() => <Redirect to="/home" />} />
        </>
      ) : (
        <>
          <Route path="/login" component={Login} />
          <Route path="/signup" component={Signup} />
          <Route path="/home" component={() => <Redirect to="/login" />} />
          <Route path="/event/:id" component={() => <Redirect to="/login" />} />
          <Route exact path="/" component={() => <Redirect to="/login" />} />
        </>
      )}
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