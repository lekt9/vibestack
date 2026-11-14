import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { visiting } from "./greeter.vibe";
import "./main.css";

// The page's greeter is this visitor's own, which the Worker that served it holds (worker.vibe): the key `?key=` names,
// or else the one this browser keeps in its localStorage.
const key = new URLSearchParams(location.search).get("key");
const runtime = ManagedRuntime.make(Layer.provide(visiting(location.origin, key), Layer.merge(FetchHttpClient.layer, KeyValueStore.layerStorage(() => localStorage))));

createRoot(document.getElementById("root")!).render(<StrictMode><App runtime={runtime} /></StrictMode>);
