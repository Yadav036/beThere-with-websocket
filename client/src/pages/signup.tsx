import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignupForm = z.infer<typeof signupSchema>;

export default function Signup() {
  const [, setLocation] = useLocation();
  const { signup } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: SignupForm) => {
    setIsLoading(true);
    try {
      await signup({
        email: data.email,
        username: data.username,
        password: data.password,
      });
      toast({
        title: "🎉 Account Created!",
        description: "Welcome to BeThere! Start creating events.",
        variant: "default"
      });
      setLocation("/home");
    } catch (error: any) {
      toast({
        title: "❌ Sign Up Failed",
        description: error.message || "Failed to create account",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 snap-header p-6 text-black">
        <div className="max-w-6xl mx-auto">
          <div className="text-3xl font-black">📸 SNAP EVENTS</div>
        </div>
      </div>

      <div className="w-full max-w-md mx-auto mt-24">
        <Card className="retro-border">
          <CardHeader className="text-center">
            <CardTitle className="text-4xl font-black text-black uppercase tracking-wider">
              Join BeThere
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-testid="form-signup">
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
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-bold text-black">USERNAME</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Choose a username..."
                          className="w-full p-3 border-4 border-black font-bold text-lg focus:ring-4 focus:ring-primary"
                          data-testid="input-username"
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
                          placeholder="Create a password..."
                          className="w-full p-3 border-4 border-black font-bold text-lg focus:ring-4 focus:ring-primary"
                          data-testid="input-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-lg font-bold text-black">CONFIRM PASSWORD</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Confirm your password..."
                          className="w-full p-3 border-4 border-black font-bold text-lg focus:ring-4 focus:ring-primary"
                          data-testid="input-confirm-password"
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
                  data-testid="button-signup"
                >
                  {isLoading ? "CREATING..." : "📸 CREATE ACCOUNT"}
                </Button>
              </form>
            </Form>

            <div className="text-center">
              <p className="text-lg font-bold text-black">Already have an account?</p>
              <Button
                variant="outline"
                onClick={() => setLocation("/login")}
                className="mt-2 font-bold retro-border border-4 border-black hover:bg-secondary"
                data-testid="link-login"
              >
                SIGN IN
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
