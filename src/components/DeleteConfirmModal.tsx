import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
} from "@chakra-ui/react";
import { useRef } from "react";

type DeleteConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  documentName: string;
  darkMode: boolean;
};

function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  documentName,
  darkMode,
}: DeleteConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      isOpen={isOpen}
      leastDestructiveRef={cancelRef}
      onClose={onClose}
    >
      <AlertDialogOverlay>
        <AlertDialogContent
          bgColor={darkMode ? "#2d2d2d" : "white"}
          color={darkMode ? "#cbcaca" : "inherit"}
        >
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            Delete Note
          </AlertDialogHeader>

          <AlertDialogBody>
            Are you sure you want to delete "{documentName || "Untitled"}"?
            This action cannot be undone.
          </AlertDialogBody>

          <AlertDialogFooter>
            <Button ref={cancelRef} onClick={onClose}>
              Cancel
            </Button>
            <Button colorScheme="red" onClick={onConfirm} ml={3}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
}

export default DeleteConfirmModal;
