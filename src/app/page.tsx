import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">Viewly</h1>
        <p className="text-muted-foreground">A local-first YouTube discovery app.</p>
      </div>
      <Button>Get started</Button>
    </main>
  );
}
