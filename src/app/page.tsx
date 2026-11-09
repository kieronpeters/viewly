import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-12 text-center text-foreground">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">Viewly</h1>
        <p className="text-muted-foreground">A local-first YouTube discovery app.</p>
      </div>
      <Button>Get started</Button>
    </div>
  );
}
