import {
  Button,
  Container,
  Flex,
  Heading,
  Input,
  InputGroup,
  InputRightElement,
  Link,
  Stack,
  Switch,
  useToast,
} from "@chakra-ui/react";
import { VscArrowLeft } from "react-icons/vsc";

import ConnectionStatus from "./ConnectionStatus";
import User from "./User";
import type { UserInfo } from "./rustpad";

export type SidebarProps = {
  documentId: string;
  connection: "connected" | "disconnected" | "desynchronized";
  darkMode: boolean;
  currentUser: UserInfo;
  users: Record<number, UserInfo>;
  isAuthenticated?: boolean;
  useFixedColors?: boolean;
  onDarkModeChange: () => void;
  onChangeName: (name: string) => void;
  onChangeColor: (hue: number) => void;
  onFixedColorsChange?: () => void;
};

function Sidebar({
  documentId,
  connection,
  darkMode,
  currentUser,
  users,
  isAuthenticated = false,
  useFixedColors = false,
  onDarkModeChange,
  onChangeName,
  onChangeColor,
  onFixedColorsChange,
}: SidebarProps) {
  const toast = useToast();

  // For sharing the document by link to others.
  const documentUrl = `${window.location.origin}/#${documentId}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(documentUrl);
    toast({
      title: "Copied!",
      description: "Link copied to clipboard",
      status: "success",
      duration: 2000,
      isClosable: true,
    });
  }

  return (
    <Container
      w={{ base: "3xs", md: "2xs", lg: "xs" }}
      display={{ base: "none", sm: "block" }}
      bgColor={darkMode ? "#252526" : "#f3f3f3"}
      overflowY="auto"
      maxW="full"
      lineHeight={1.4}
      py={4}
    >
      <Link
        href="#"
        display="flex"
        alignItems="center"
        gap={1}
        fontSize="sm"
        color={darkMode ? "blue.300" : "blue.600"}
        mb={3}
        _hover={{ textDecoration: "underline" }}
      >
        <VscArrowLeft /> All Notes
      </Link>

      <ConnectionStatus darkMode={darkMode} connection={connection} />

      <Flex justifyContent="space-between" mt={4} mb={1.5} w="full">
        <Heading size="sm">Dark Mode</Heading>
        <Switch isChecked={darkMode} onChange={onDarkModeChange} />
      </Flex>

      <Flex justifyContent="space-between" mt={2} mb={1.5} w="full">
        <Heading size="sm">Fixed Colors</Heading>
        <Switch isChecked={useFixedColors} onChange={onFixedColorsChange} />
      </Flex>

      <Heading mt={4} mb={1.5} size="sm">
        Share Link
      </Heading>
      <InputGroup size="sm">
        <Input
          readOnly
          pr="3.5rem"
          variant="outline"
          bgColor={darkMode ? "#3c3c3c" : "white"}
          borderColor={darkMode ? "#3c3c3c" : "white"}
          value={documentUrl}
        />
        <InputRightElement width="3.5rem">
          <Button
            h="1.4rem"
            size="xs"
            onClick={handleCopy}
            _hover={{ bg: darkMode ? "#575759" : "gray.200" }}
            bgColor={darkMode ? "#575759" : "gray.200"}
            color={darkMode ? "white" : "inherit"}
          >
            Copy
          </Button>
        </InputRightElement>
      </InputGroup>

      <Heading mt={4} mb={1.5} size="sm">
        Active Users
      </Heading>
      <Stack spacing={0} mb={1.5} fontSize="sm">
        <User
          info={currentUser}
          isMe
          isAuthenticated={isAuthenticated}
          onChangeName={onChangeName}
          onChangeColor={onChangeColor}
          darkMode={darkMode}
        />
        {Object.entries(users).map(([id, info]) => (
          <User key={id} info={info} darkMode={darkMode} />
        ))}
      </Stack>
    </Container>
  );
}

export default Sidebar;
