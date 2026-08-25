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

@interface MakeIdInquiryDelegate : NSObject <IOBluetoothDeviceInquiryDelegate>
@property(nonatomic, strong) NSMutableArray<IOBluetoothDevice *> *devices;
@property(nonatomic) BOOL finished;
@end

@implementation MakeIdInquiryDelegate
- (instancetype)init {
  self = [super init];
  if (self) {
    _devices = [NSMutableArray array];
  }
  return self;
}

- (void)deviceInquiryDeviceFound:(IOBluetoothDeviceInquiry *)sender
                          device:(IOBluetoothDevice *)device {
  if (device != nil) [self.devices addObject:device];
}

- (void)deviceInquiryComplete:(IOBluetoothDeviceInquiry *)sender
                         error:(IOReturn)error
                       aborted:(BOOL)aborted {
  self.finished = YES;
}
@end

@interface MakeIdPairDelegate : NSObject <IOBluetoothDevicePairDelegate>
@property(nonatomic) BOOL finished;
@property(nonatomic) IOReturn error;
@end

@implementation MakeIdPairDelegate
- (void)devicePairingUserConfirmationRequest:(id)sender
                                numericValue:(BluetoothNumericValue)numericValue {
  [(IOBluetoothDevicePair *)sender replyUserConfirmation:YES];
}

- (void)devicePairingPINCodeRequest:(id)sender {
  [(IOBluetoothDevicePair *)sender replyPINCode:0 PINCode:NULL];
}

- (void)devicePairingFinished:(id)sender error:(IOReturn)error {
  self.error = error;
  self.finished = YES;
}
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

static void AppendDevice(NSMutableDictionary *result, IOBluetoothDevice *device) {
  NSString *address = device.addressString;
  if (address.length == 0) return;
  NSString *key = address.uppercaseString;
  NSString *name = device.name;
  NSMutableDictionary *entry = [@{ @"id" : address } mutableCopy];
  if (name.length > 0) entry[@"name"] = name;
  result[key] = entry;
}

static void Discover(BOOL includeUnpaired) {
  NSMutableDictionary *devices = [NSMutableDictionary dictionary];
  for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices] ?: @[]) {
    AppendDevice(devices, device);
  }

  if (includeUnpaired) {
    MakeIdInquiryDelegate *delegate = [MakeIdInquiryDelegate new];
    IOBluetoothDeviceInquiry *inquiry = [IOBluetoothDeviceInquiry inquiryWithDelegate:delegate];
    // The desktop discovery request is bounded to five seconds. Leave room
    // for name updates and JSON output before that deadline expires.
    inquiry.inquiryLength = 3;
    inquiry.updateNewDeviceNames = YES;
    IOReturn startStatus = [inquiry start];
    if (startStatus == kIOReturnSuccess) {
      NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:3.75];
      while (!delegate.finished && [deadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
      }
      if (!delegate.finished) [inquiry stop];
      // Nearby discovery is best-effort. A throttled or incomplete inquiry
      // must not hide the paired devices which are already in the result.
      for (IOBluetoothDevice *device in delegate.devices) {
        AppendDevice(devices, device);
      }
    }
  }

  NSMutableArray *result = [NSMutableArray arrayWithArray:devices.allValues];
  [result sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    return [left[@"id"] compare:right[@"id"]];
  }];
  NSError *error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
  if (json == nil) Fail(error.localizedDescription ?: @"Could not encode paired Bluetooth devices", 2);
  [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
}

static void PairDevice(IOBluetoothDevice *device) {
  if (device.isPaired) return;
  MakeIdPairDelegate *delegate = [MakeIdPairDelegate new];
  IOBluetoothDevicePair *pair = [IOBluetoothDevicePair pairWithDevice:device];
  pair.delegate = delegate;
  IOReturn startStatus = [pair start];
  if (startStatus != kIOReturnSuccess) {
    Fail([NSString stringWithFormat:@"Bluetooth pairing could not start (%d)", startStatus], 10);
  }
  // The TypeScript transport waits 20 seconds for READY. Leave time for the
  // RFCOMM open after the native pairing operation completes.
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:12.0];
  while (!delegate.finished && [deadline timeIntervalSinceNow] > 0) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  }
  if (!delegate.finished) {
    [pair stop];
    Fail(@"Bluetooth pairing timed out", 11);
  }
  if (delegate.error != kIOReturnSuccess || !device.isPaired) {
    Fail([NSString stringWithFormat:@"Bluetooth pairing failed (%d)", delegate.error], 12);
  }
}

static void Connect(NSString *address) {
  IOBluetoothDevice *device = [IOBluetoothDevice deviceWithAddressString:address];
  if (device == nil) Fail(@"The Bluetooth device address is invalid", 3);
  PairDevice(device);

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
    if (argc >= 2 && strcmp(argv[1], "discover") == 0) {
      BOOL includeUnpaired = argc == 3 && strcmp(argv[2], "--include-unpaired") == 0;
      if (argc > 3 || (argc == 3 && !includeUnpaired)) {
        Fail(@"Usage: makeid-bluetooth-helper discover [--include-unpaired]", 64);
      }
      Discover(includeUnpaired);
      return 0;
    }
    if (argc == 3 && strcmp(argv[1], "connect") == 0) {
      Connect([NSString stringWithUTF8String:argv[2]]);
      return 0;
    }
    Fail(@"Usage: makeid-bluetooth-helper discover | connect DEVICE_ADDRESS", 64);
  }
}
