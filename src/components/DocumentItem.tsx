import {
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { VscEdit, VscFile, VscTrash } from "react-icons/vsc";

import type { DocumentMeta } from "../api/documents";

type DocumentItemProps = {
  document: DocumentMeta;
  darkMode: boolean;
  onRename: (name: string) => Promise<DocumentMeta>;
  onDelete: () => void;
};

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  return date.toLocaleDateString();
}

function DocumentItem({
  document,
  darkMode,
  onRename,
  onDelete,
}: DocumentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(document.name || "");

  const handleSave = async () => {
    if (editName.trim() && editName !== document.name) {
      await onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setEditName(document.name || "");
      setIsEditing(false);
    }
  };

  const navigateToDoc = () => {
    window.location.hash = document.id;
  };

  return (
    <Flex
      p={3}
      minH="56px"
      rounded="md"
      bgColor={darkMode ? "#2d2d2d" : "gray.50"}
      _hover={{ bgColor: darkMode ? "#3d3d3d" : "gray.100" }}
      align="center"
      justify="space-between"
      cursor="pointer"
      onClick={navigateToDoc}
    >
      <HStack flex={1} spacing={3} overflow="hidden">
        <Icon as={VscFile} color="blue.400" fontSize="xl" flexShrink={0} />
        {isEditing ? (
          <Input
            size="sm"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            bgColor={darkMode ? "#3c3c3c" : "white"}
            borderColor={darkMode ? "#555" : "gray.300"}
          />
        ) : (
          <Flex direction="column" overflow="hidden" flex={1}>
            <Text fontWeight="medium" isTruncated>
              {document.name || `Untitled`}
            </Text>
            <Text
              fontSize="xs"
              color={darkMode ? "gray.400" : "gray.500"}
              isTruncated
            >
              {formatDate(document.updated_at)}
              {document.language &&
                document.language !== "plaintext" &&
                ` · ${document.language}`}
            </Text>
          </Flex>
        )}
      </HStack>

      <HStack spacing={1} flexShrink={0}>
        <IconButton
          aria-label="Rename"
          icon={<VscEdit />}
          size="sm"
          variant="ghost"
          color={darkMode ? "gray.300" : "gray.600"}
          onClick={(e) => {
            e.stopPropagation();
            setEditName(document.name || "");
            setIsEditing(true);
          }}
        />
        <IconButton
          aria-label="Delete"
          icon={<VscTrash />}
          size="sm"
          variant="ghost"
          color={darkMode ? "gray.300" : "gray.600"}
          _hover={{ color: "red.400" }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </HStack>
    </Flex>
  );
}

export default DocumentItem;
