import { Box, Flex, HStack, Icon, Text, useToast } from "@chakra-ui/react";
import Editor from "@monaco-editor/react";
import { editor } from "monaco-editor/esm/vs/editor/editor.api";
import { useEffect, useRef, useState } from "react";
import { VscChevronRight, VscFolderOpened, VscGist } from "react-icons/vsc";
import useLocalStorageState from "use-local-storage-state";

import DocumentList from "./views/DocumentList";
import Footer from "./Footer";
import Sidebar from "./Sidebar";
import animals from "./animals.json";
import languages from "./languages.json";
import Rustpad, { UserInfo } from "./rustpad";
import { registerShortcutProvider } from "./shortcutProvider";
import useHash from "./useHash";

function getWsUri(id: string) {
  let url = new URL(`api/socket/${id}`, window.location.href);
  url.protocol = url.protocol == "https:" ? "wss:" : "ws:";
  return url.href;
}

function generateName() {
  return "Anonymous " + animals[Math.floor(Math.random() * animals.length)];
}

function generateHue() {
  return Math.floor(Math.random() * 360);
}

function App() {
  const toast = useToast();
  const [language, setLanguage] = useState("plaintext");
  const [connection, setConnection] = useState<
    "connected" | "disconnected" | "desynchronized"
  >("disconnected");
  const [users, setUsers] = useState<Record<number, UserInfo>>({});
  const [name, setName] = useLocalStorageState("name", {
    defaultValue: generateName,
  });
  const [hue, setHue] = useLocalStorageState("hue", {
    defaultValue: generateHue,
  });
  const [editor, setEditor] = useState<editor.IStandaloneCodeEditor>();
  const [darkMode, setDarkMode] = useLocalStorageState("darkMode", {
    defaultValue: false,
  });
  const rustpad = useRef<Rustpad>();
  const rustpadDocId = useRef<string | null>(null);
  const rustpadEditor = useRef<editor.IStandaloneCodeEditor | null>(null);
  const id = useHash();

  // Effects must be called unconditionally (React hooks rules)
  // Note: we intentionally exclude toast/setUsers from deps to prevent reconnection loops
  useEffect(() => {
    console.log("[Rustpad Effect] id:", id, "editor:", !!editor, "rustpad:", !!rustpad.current, "docId:", rustpadDocId.current);

    if (!id || !editor?.getModel()) {
      console.log("[Rustpad Effect] Early return - missing id or editor");
      return;
    }

    // If we already have a Rustpad for the same document AND same editor, don't recreate
    // Must check both: document could be same but editor remounted (navigation)
    if (rustpad.current && rustpadDocId.current === id && rustpadEditor.current === editor) {
      console.log("[Rustpad Effect] Skipping - already have Rustpad for this doc and editor");
      return;
    }

    // Clean up old Rustpad if switching documents or editor changed
    if (rustpad.current) {
      console.log("[Rustpad Effect] Disposing old Rustpad (doc or editor changed)");
      rustpad.current.dispose();
      rustpad.current = undefined;
    }

    console.log("[Rustpad Effect] Creating new Rustpad for:", id);
    rustpadDocId.current = id;
    rustpadEditor.current = editor;
    const model = editor.getModel()!;
    model.setValue("");
    model.setEOL(0); // LF
    rustpad.current = new Rustpad({
      uri: getWsUri(id),
      editor,
      onConnected: () => setConnection("connected"),
      onDisconnected: () => setConnection("disconnected"),
      onDesynchronized: () => {
        setConnection("desynchronized");
        toast({
          title: "Desynchronized with server",
          description: "Please save your work and refresh the page.",
          status: "error",
          duration: null,
        });
      },
      onChangeLanguage: (language) => {
        if (languages.includes(language)) {
          setLanguage(language);
        }
      },
      onChangeUsers: setUsers,
    });
    // No cleanup return - we manage Rustpad lifecycle manually based on document ID
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editor]);

  // Cleanup on unmount only
  useEffect(() => {
    console.log("[Unmount Effect] Mounted");
    return () => {
      console.log("[Unmount Effect] CLEANUP - disposing Rustpad");
      rustpad.current?.dispose();
      rustpad.current = undefined;
      rustpadDocId.current = null;
    };
  }, []);

  useEffect(() => {
    if (connection === "connected") {
      rustpad.current?.setInfo({ name, hue });
    }
  }, [connection, name, hue]);

  // If no hash, show document list
  if (!id) {
    return <DocumentList />;
  }

  function handleDarkModeChange() {
    setDarkMode(!darkMode);
  }

  return (
    <Flex
      direction="column"
      h="100vh"
      overflow="hidden"
      bgColor={darkMode ? "#1e1e1e" : "white"}
      color={darkMode ? "#cbcaca" : "inherit"}
    >
      <Box
        flexShrink={0}
        bgColor={darkMode ? "#333333" : "#e8e8e8"}
        color={darkMode ? "#cccccc" : "#383838"}
        textAlign="center"
        fontSize="sm"
        py={0.5}
      >
        Scribblr
      </Box>
      <Flex flex="1 0" minH={0}>
        <Sidebar
          documentId={id}
          connection={connection}
          darkMode={darkMode}
          currentUser={{ name, hue }}
          users={users}
          onDarkModeChange={handleDarkModeChange}
          onChangeName={(name) => name.length > 0 && setName(name)}
          onChangeColor={() => setHue(generateHue())}
        />

        <Flex flex={1} minW={0} h="100%" direction="column" overflow="hidden">
          <HStack
            h={6}
            spacing={1}
            color="#888888"
            fontWeight="medium"
            fontSize="13px"
            px={3.5}
            flexShrink={0}
          >
            <Icon as={VscFolderOpened} fontSize="md" color="blue.500" />
            <Text>documents</Text>
            <Icon as={VscChevronRight} fontSize="md" />
            <Icon as={VscGist} fontSize="md" color="purple.500" />
            <Text>{id}</Text>
          </HStack>
          <Box flex={1} minH={0}>
            <Editor
              theme={darkMode ? "vs-dark" : "vs"}
              language={language}
              options={{
                automaticLayout: true,
                fontSize: 13,
              }}
              onMount={(editor, monaco) => {
                console.log("[Monaco] onMount fired");
                setEditor(editor);
                registerShortcutProvider(monaco);
              }}
            />
          </Box>
        </Flex>
      </Flex>
      <Footer />
    </Flex>
  );
}

export default App;
