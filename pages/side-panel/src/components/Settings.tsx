import React from 'react';
import { VStack, HStack, Avatar, Text, Switch, Link, Button, Image } from '@chakra-ui/react';

const Settings = () => {
  return (
    <VStack spacing={4}>
      <Link href="https://www.keepkey.com" isExternal w="100%">
        <Button variant="ghost" w="100%">
          About KeepKey
        </Button>
      </Link>
      <Image src={'https://i.ibb.co/jR8WcJM/kk.gif'} alt="KeepKey" />
      <VStack spacing={4} align="stretch">
        <Text fontSize="md" fontWeight="bold">
          Enable Masking
        </Text>
        <HStack w="100%" justifyContent="space-between">
          <HStack>
            <Avatar
              size="md"
              name="Firefox"
              src="https://forum.zeroqode.com/uploads/default/original/2X/4/401498d7adfbb383fea695394f4f653ea4e7c9a7.png"
            />
            <Text>Enable Firefox</Text>
          </HStack>
          <Switch size="md" />
        </HStack>
        <HStack w="100%" justifyContent="space-between">
          <HStack>
            <Avatar
              size="md"
              name="XDEFI"
              src="https://images.crunchbase.com/image/upload/c_pad,f_auto,q_auto:eco,dpr_1/cs5s7reskl2onltpd7gw"
            />
            <Text>Enable XDEFI</Text>
          </HStack>
          <Switch size="md" />
        </HStack>
        <HStack w="100%" justifyContent="space-between">
          <HStack>
            <Avatar
              size="md"
              name="Keplr"
              src="https://cdn.dealspotr.com/io-images/logo/keplr.jpg?fit=contain&trim=true&flatten=true&extend=10&width=500&height=500"
            />
            <Text>Enable Keplr</Text>
          </HStack>
          <Switch size="md" />
        </HStack>
        <Text fontSize="sm" color="gray.500">
          This setting may conflict with these apps if also enabled.
        </Text>
      </VStack>
    </VStack>
  );
};

export default Settings;
