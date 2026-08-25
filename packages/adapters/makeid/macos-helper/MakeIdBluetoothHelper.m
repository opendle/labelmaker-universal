#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>

static void Fail(NSString *message, int code) {
  NSData *data = [[message stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding];
  [[NSFileHandle fileHandleWithStandardError] writeData:data];
  exit(code);
}

@interface MakeIdRFCOMMBridge : NSObject <IOBluetoothRFCOMMChannelDelegate>
@property(nonatomic, strong) IOBluetoothRFCOMMChannel *channel;
@property(nonatomic) BOOL closed;
@end

@implementation MakeIdRFCOMMBridge
- (void)rfcommChannelData:(IOBluetoothRFCOMMChannel *)channel
                     data:(void *)dataPointer
                   length:(size_t)dataLength {
  NSData *data = [NSData dataWithBytes:dataPointer length:dataLength];
  [[NSFileHandle fileHandleWithStandardOutput] writeData:data];
}

- (void)rfcommChannelClosed:(IOBluetoothRFCOMMChannel *)channel {
  self.closed = YES;
}
@end

static void Discover(void) {
  NSMutableArray *result = [NSMutableArray array];
  for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices] ?: @[]) {
    NSString *address = device.addressString;
    if (address.length == 0) continue;
    NSString *name = device.name;
    NSMutableDictionary *entry = [@{ @"id" : address } mutableCopy];
    if (name.length > 0) entry[@"name"] = name;
    [result addObject:entry];
  }
  NSError *error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
  if (json == nil) Fail(error.localizedDescription ?: @"Could not encode paired Bluetooth devices", 2);
  [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
}

static void Connect(NSString *address) {
  IOBluetoothDevice *device = [IOBluetoothDevice deviceWithAddressString:address];
  if (device == nil) Fail(@"The Bluetooth device address is invalid", 3);
  if (!device.isPaired) Fail(@"Pair the MakeID printer in macOS Bluetooth settings first", 4);

  MakeIdRFCOMMBridge *bridge = [MakeIdRFCOMMBridge new];
  // The E1 uses channel 1. Its SDP server can fail to answer on macOS. The
  // public HelixScreen E1 integration uses the same channel as its fallback.
  const BluetoothRFCOMMChannelID channelID = 1;
  IOBluetoothRFCOMMChannel *channel = nil;
  IOReturn status = [device openRFCOMMChannelSync:&channel withChannelID:channelID delegate:bridge];
  if (status != kIOReturnSuccess || channel == nil) Fail([NSString stringWithFormat:@"Could not open the printer serial channel (%d)", status], 9);
  bridge.channel = channel;

  [[NSFileHandle fileHandleWithStandardError] writeData:[@"READY\n" dataUsingEncoding:NSUTF8StringEncoding]];
  NSFileHandle *input = [NSFileHandle fileHandleWithStandardInput];
  input.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (data.length == 0) {
      bridge.closed = YES;
      return;
    }
    const uint8_t *bytes = data.bytes;
    NSUInteger offset = 0;
    NSUInteger mtu = MAX((NSUInteger)1, (NSUInteger)channel.getMTU);
    while (offset < data.length) {
      UInt16 length = (UInt16)MIN(MIN(mtu, (NSUInteger)UINT16_MAX), data.length - offset);
      IOReturn writeStatus = [channel writeSync:(void *)(bytes + offset) length:length];
      if (writeStatus != kIOReturnSuccess) {
        NSData *message = [[NSString stringWithFormat:@"The printer write failed (%d)\n", writeStatus] dataUsingEncoding:NSUTF8StringEncoding];
        [[NSFileHandle fileHandleWithStandardError] writeData:message];
        bridge.closed = YES;
        return;
      }
      offset += length;
    }
  };

  while (!bridge.closed) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  }
  input.readabilityHandler = nil;
  [channel closeChannel];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 2 && strcmp(argv[1], "discover") == 0) {
      Discover();
      return 0;
    }
    if (argc == 3 && strcmp(argv[1], "connect") == 0) {
      Connect([NSString stringWithUTF8String:argv[2]]);
      return 0;
    }
    Fail(@"Usage: makeid-bluetooth-helper discover | connect DEVICE_ADDRESS", 64);
  }
}
