// Import WASM wrapper first to ensure initialization before any code uses OpSeq
import "./wasm";

import { ChakraProvider } from "@chakra-ui/react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ChakraProvider>
    <App />
  </ChakraProvider>,
);
