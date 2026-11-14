import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { remote } from "./greeter.vibe";
import "./main.css";

// The page's greeter is the one the Worker that served it holds under the key "app" (worker.vibe).
const runtime = ManagedRuntime.make(Layer.provide(remote(location.origin, "app"), FetchHttpClient.layer));

createRoot(document.getElementById("root")!).render(<StrictMode><App runtime={runtime} /></StrictMode>);
