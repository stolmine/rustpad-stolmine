import {
  Box,
  ButtonGroup,
  Button,
  HStack,
  Icon,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { useRef } from "react";
import { VscAccount } from "react-icons/vsc";

import { UserInfo } from "./rustpad";

type UserProps = {
  info: UserInfo;
  isMe?: boolean;
  isAuthenticated?: boolean;
  onChangeName?: (name: string) => void;
  onChangeColor?: (hue: number) => void;
  darkMode: boolean;
};

function User({
  info,
  isMe = false,
  isAuthenticated = false,
  onChangeName,
  onChangeColor,
  darkMode,
}: UserProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const nameColor = `hsl(${info.hue}, 90%, ${darkMode ? "70%" : "25%"})`;

  // For authenticated users: show name (non-editable) but allow color change
  // For anonymous users: allow both name and color change
  return (
    <Popover
      placement="right"
      isOpen={isOpen}
      onClose={onClose}
      initialFocusRef={inputRef}
    >
      <PopoverTrigger>
        <HStack
          p={2}
          rounded="md"
          _hover={{
            bgColor: isMe ? (darkMode ? "#464647" : "gray.200") : undefined,
            cursor: isMe ? "pointer" : undefined,
          }}
          onClick={() => isMe && onOpen()}
        >
          <Icon as={VscAccount} />
          <Text fontWeight="medium" color={nameColor}>
            {info.name}
          </Text>
          {isMe && <Text>(you)</Text>}
        </HStack>
      </PopoverTrigger>
      <PopoverContent
        bgColor={darkMode ? "#333333" : "white"}
        borderColor={darkMode ? "#464647" : "gray.200"}
      >
        <PopoverHeader
          fontWeight="semibold"
          borderColor={darkMode ? "#464647" : "gray.200"}
        >
          {isAuthenticated ? "Change Color" : "Update Info"}
        </PopoverHeader>
        <PopoverArrow bgColor={darkMode ? "#333333" : "white"} />
        <PopoverCloseButton />
        <PopoverBody borderColor={darkMode ? "#464647" : "gray.200"}>
          {!isAuthenticated && (
            <Input
              ref={inputRef}
              mb={2}
              value={info.name}
              maxLength={25}
              onChange={(event) => onChangeName?.(event.target.value)}
            />
          )}
          <Text fontSize="sm" mb={1}>Color</Text>
          <Box
            h="24px"
            mb={2}
            borderRadius="md"
            bg={`linear-gradient(to right,
              hsl(0, 70%, 50%),
              hsl(60, 70%, 50%),
              hsl(120, 70%, 50%),
              hsl(180, 70%, 50%),
              hsl(240, 70%, 50%),
              hsl(300, 70%, 50%),
              hsl(360, 70%, 50%))`}
          />
          <Slider
            aria-label="color-hue"
            min={0}
            max={360}
            value={info.hue}
            onChange={(val) => onChangeColor?.(val)}
          >
            <SliderTrack bg="transparent">
              <SliderFilledTrack bg="transparent" />
            </SliderTrack>
            <SliderThumb
              boxSize={5}
              bg={`hsl(${info.hue}, 70%, 50%)`}
              border="2px solid white"
              boxShadow="md"
            />
          </Slider>
        </PopoverBody>
        <PopoverFooter
          display="flex"
          justifyContent="flex-end"
          borderColor={darkMode ? "#464647" : "gray.200"}
        >
          <ButtonGroup size="sm">
            <Button colorScheme="blue" onClick={onClose}>
              Done
            </Button>
          </ButtonGroup>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}

export default User;
