import {
  Button,
  Icon,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { FaBomb } from "react-icons/fa";

type KablammoModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  darkMode: boolean;
};

function KablammoModal({
  isOpen,
  onClose,
  onConfirm,
  darkMode,
}: KablammoModalProps) {
  const [confirmText, setConfirmText] = useState("");

  const isConfirmEnabled = confirmText.toLowerCase() === "kablammo";

  const handleClose = () => {
    setConfirmText("");
    onClose();
  };

  const handleConfirm = () => {
    if (isConfirmEnabled) {
      setConfirmText("");
      onConfirm();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} isCentered>
      <ModalOverlay />
      <ModalContent
        bgColor={darkMode ? "#2d2d2d" : "white"}
        color={darkMode ? "#cbcaca" : "inherit"}
      >
        <ModalHeader display="flex" alignItems="center" gap={2}>
          <Icon as={FaBomb} color="red.500" />
          Delete All Notes
        </ModalHeader>

        <ModalBody>
          <VStack spacing={4} align="stretch">
            <Text fontWeight="bold" color="red.500">
              Are you sure you want to end it all?
            </Text>
            <Text fontSize="sm" color={darkMode ? "gray.400" : "gray.600"}>
              This will delete all your notes. This action cannot be undone.
            </Text>
            <Text fontSize="sm">
              Type <strong>kablammo</strong> to confirm:
            </Text>
            <Input
              placeholder="Type kablammo to confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              bgColor={darkMode ? "#3c3c3c" : "white"}
              borderColor={darkMode ? "#555" : "gray.200"}
              _placeholder={{ color: darkMode ? "gray.500" : "gray.400" }}
            />
          </VStack>
        </ModalBody>

        <ModalFooter>
          <Button mr={3} onClick={handleClose}>
            Cancel
          </Button>
          <Button
            colorScheme="red"
            onClick={handleConfirm}
            isDisabled={!isConfirmEnabled}
            leftIcon={<Icon as={FaBomb} />}
          >
            Kablammo!
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default KablammoModal;
