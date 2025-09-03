import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/home");
    }
  }, [isAuthenticated, setLocation]);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      const result = await login(data);

      toast({
        title: "Welcome back!",
        description: `Successfully signed in as ${result.user.username}`,
        variant: "default",
      });

      // Navigation will happen automatically via useEffect when isAuthenticated changes
    } catch (error: any) {
      toast({
        title: "Sign In Failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Don't render if already authenticated (prevents flash)
  if (isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-2xl font-black text-primary">REDIRECTING...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 snap-header p-6 text-black">
        <div className="max-w-6xl mx-auto">
          <div className="text-3xl font-black">SNAP EVENTS</div>
        </div>
      </div>

      <div className="w-full max-w-md mx-auto mt-24">
        <Card className="retro-border">
          <CardHeader className="text-center">
            <CardTitle className="text-4xl font-black text-black uppercase tracking-wider">
              Welcome Back
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="form-login">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-bold text-black">EMAIL</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          placeholder="Enter your email..."
                          className="w-full p-3 border-4 border-black font-bold text-lg focus:ring-4 focus:ring-primary"
                          data-testid="input-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-bold text-black">PASSWORD</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Enter your password..."
                          className="w-full p-3 border-4 border-black font-bold text-lg focus:ring-4 focus:ring-primary"
                          data-testid="input-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-primary text-black p-4 text-xl font-black retro-border hover:bg-yellow-400 transition-colors uppercase tracking-wider"
                  data-testid="button-signin"
                >
                  {isLoading ? "SIGNING IN..." : "SIGN IN"}
                </Button>
              </form>
            </Form>

            <div className="text-center">
              <p className="text-lg font-bold text-black">Don't have an account?</p>
              <Button
                variant="outline"
                onClick={() => setLocation("/signup")}
                className="mt-2 font-bold retro-border border-4 border-black hover:bg-secondary"
                data-testid="link-signup"
              >
                CREATE ACCOUNT
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}