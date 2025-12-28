import {
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Spinner,
  Stack,
  Switch,
  Text,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { useState } from "react";
import { FaBomb } from "react-icons/fa";
import { VscAdd, VscSearch } from "react-icons/vsc";
import useLocalStorageState from "use-local-storage-state";

import type { DocumentMeta } from "../api/documents";
import CreateNoteModal from "../components/CreateNoteModal";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import DocumentItem from "../components/DocumentItem";
import KablammoModal from "../components/KablammoModal";
import { useDocuments } from "../hooks/useDocuments";

function DocumentList() {
  const [darkMode, setDarkMode] = useLocalStorageState("darkMode", {
    defaultValue: false,
  });
  const [search, setSearch] = useState("");
  const { documents, loading, create, rename, remove, deleteAll } = useDocuments();
  const createModal = useDisclosure();
  const deleteModal = useDisclosure();
  const kablammoModal = useDisclosure();
  const [deleteTarget, setDeleteTarget] = useState<DocumentMeta | null>(null);
  const toast = useToast();

  const filteredDocs = documents.filter(
    (doc) =>
      (doc.name?.toLowerCase() || "").includes(search.toLowerCase()) ||
      doc.id.toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = async (title: string) => {
    const doc = await create(title);
    window.location.hash = doc.id;
  };

  const handleDelete = (doc: DocumentMeta) => {
    setDeleteTarget(doc);
    deleteModal.onOpen();
  };

  const confirmDelete = async () => {
    if (deleteTarget) {
      await remove(deleteTarget.id);
      deleteModal.onClose();
      setDeleteTarget(null);
    }
  };

  const confirmKablammo = async () => {
    await deleteAll();
    kablammoModal.onClose();
    toast({
      title: "All notes have been deleted",
      status: "success",
      duration: 3000,
      isClosable: true,
    });
  };

  return (
    <Flex
      direction="column"
      h="100vh"
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

      <Container
        maxW="2xl"
        py={{ base: 4, md: 8 }}
        px={{ base: 4, md: 6 }}
        flex={1}
        overflowY="auto"
      >
        <Flex
          direction={{ base: "column", sm: "row" }}
          justify="space-between"
          align={{ base: "stretch", sm: "center" }}
          gap={3}
          mb={6}
        >
          <Heading size="lg">My Notes</Heading>
          <Flex align="center" gap={4}>
            <Flex align="center" gap={2}>
              <Text fontSize="sm">Dark</Text>
              <Switch
                isChecked={darkMode}
                onChange={() => setDarkMode(!darkMode)}
                colorScheme="blue"
              />
            </Flex>
            <Button
              leftIcon={<Icon as={VscAdd} />}
              colorScheme="blue"
              size="sm"
              onClick={createModal.onOpen}
            >
              New Note
            </Button>
            <IconButton
              aria-label="Delete all notes"
              icon={<Icon as={FaBomb} />}
              colorScheme="red"
              variant="ghost"
              size="sm"
              onClick={kablammoModal.onOpen}
            />
          </Flex>
        </Flex>

        <InputGroup mb={6} size="md">
          <InputLeftElement>
            <Icon as={VscSearch} color="gray.400" />
          </InputLeftElement>
          <Input
            placeholder="Search notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            bgColor={darkMode ? "#3c3c3c" : "white"}
            borderColor={darkMode ? "#555" : "gray.200"}
            _placeholder={{ color: darkMode ? "gray.500" : "gray.400" }}
          />
        </InputGroup>

        {loading ? (
          <Flex justify="center" py={8}>
            <Spinner size="lg" color="blue.400" />
          </Flex>
        ) : filteredDocs.length === 0 ? (
          <Flex direction="column" align="center" py={8} gap={3}>
            <Text color={darkMode ? "gray.400" : "gray.500"}>
              {search ? "No notes match your search" : "No notes yet"}
            </Text>
            {!search && (
              <Button
                leftIcon={<Icon as={VscAdd} />}
                colorScheme="blue"
                variant="outline"
                onClick={createModal.onOpen}
              >
                Create your first note
              </Button>
            )}
          </Flex>
        ) : (
          <Stack spacing={2}>
            {filteredDocs.map((doc) => (
              <DocumentItem
                key={doc.id}
                document={doc}
                darkMode={darkMode}
                onRename={(name) => rename(doc.id, name)}
                onDelete={() => handleDelete(doc)}
              />
            ))}
          </Stack>
        )}
      </Container>

      <CreateNoteModal
        isOpen={createModal.isOpen}
        onClose={createModal.onClose}
        onConfirm={handleCreate}
        darkMode={darkMode}
      />

      <DeleteConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={deleteModal.onClose}
        onConfirm={confirmDelete}
        documentName={deleteTarget?.name || deleteTarget?.id || ""}
        darkMode={darkMode}
      />

      <KablammoModal
        isOpen={kablammoModal.isOpen}
        onClose={kablammoModal.onClose}
        onConfirm={confirmKablammo}
        darkMode={darkMode}
      />
    </Flex>
  );
}

export default DocumentList;
