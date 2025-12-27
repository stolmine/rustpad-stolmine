import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from "@chakra-ui/react";
import { useRef, useState } from "react";

type CreateNoteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (title: string) => void;
  darkMode: boolean;
};

function CreateNoteModal({
  isOpen,
  onClose,
  onConfirm,
  darkMode,
}: CreateNoteModalProps) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (title.trim()) {
      onConfirm(title.trim());
      setTitle("");
      onClose();
    }
  };

  const handleClose = () => {
    setTitle("");
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      initialFocusRef={inputRef}
    >
      <ModalOverlay />
      <ModalContent
        bgColor={darkMode ? "#2d2d2d" : "white"}
        color={darkMode ? "#cbcaca" : "inherit"}
      >
        <ModalHeader fontSize="lg" fontWeight="bold">
          Create New Note
        </ModalHeader>

        <ModalBody>
          <Input
            ref={inputRef}
            placeholder="Enter note title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            bgColor={darkMode ? "#3c3c3c" : "white"}
            borderColor={darkMode ? "#555" : "gray.200"}
            _placeholder={{ color: darkMode ? "gray.500" : "gray.400" }}
          />
        </ModalBody>

        <ModalFooter>
          <Button onClick={handleClose}>
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={handleSubmit}
            ml={3}
            isDisabled={!title.trim()}
          >
            Create
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default CreateNoteModal;
