#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#import <CommonCrypto/CommonDigest.h>

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

@interface MakeIdSDPDelegate : NSObject <IOBluetoothDeviceAsyncCallbacks>
@property(nonatomic) BOOL finished;
@property(nonatomic) IOReturn status;
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


@implementation MakeIdSDPDelegate
- (instancetype)init {
  self = [super init];
  if (self) {
    _status = kIOReturnError;
  }
  return self;
}

- (void)sdpQueryComplete:(IOBluetoothDevice *)device status:(IOReturn)status {
  self.status = status;
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

static NSString *OpaqueDeviceId(NSString *address) {
  NSData *data =
      [address.uppercaseString dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex = [NSMutableString stringWithCapacity:24];
  for (NSUInteger index = 0; index < 12; index += 1) {
    [hex appendFormat:@"%02x", digest[index]];
  }
  return [@"macos-bt-" stringByAppendingString:hex];
}

static BOOL IsOpaqueDeviceId(NSString *value) {
  if (value.length != 33 || ![value hasPrefix:@"macos-bt-"]) return NO;
  NSString *suffix = [value substringFromIndex:9];
  NSCharacterSet *hex =
      [NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"];
  NSCharacterSet *invalid = hex.invertedSet;
  return [suffix rangeOfCharacterFromSet:invalid].location == NSNotFound;
}

static IOBluetoothDevice *ResolveDevice(NSString *deviceId) {
  if (!IsOpaqueDeviceId(deviceId)) {
    IOBluetoothDevice *device = [IOBluetoothDevice deviceWithAddressString:deviceId];
    if (device == nil) Fail(@"The Bluetooth device ID is invalid", 3);
    return device;
  }

  for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices] ?: @[]) {
    NSString *address = device.addressString;
    if (address.length > 0 &&
        [OpaqueDeviceId(address) caseInsensitiveCompare:deviceId] ==
            NSOrderedSame) {
      return device;
    }
  }
  Fail(@"The saved Bluetooth printer is not available", 4);
  return nil;
}

static void AddSerialPortChannels(NSMutableOrderedSet<NSNumber *> *channels,
                                  NSArray *services) {
  for (IOBluetoothSDPServiceRecord *service in services) {
    if (![service
            matchesUUID16:kBluetoothSDPUUID16ServiceClassSerialPort]) {
      continue;
    }
    BluetoothRFCOMMChannelID channelID = 0;
    if ([service getRFCOMMChannelID:&channelID] == kIOReturnSuccess &&
        channelID >= 1 && channelID <= 30) {
      [channels addObject:@(channelID)];
    }
  }
}

static void PumpRunLoop(NSTimeInterval seconds) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while ([deadline timeIntervalSinceNow] > 0) {
    [[NSRunLoop currentRunLoop]
        runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  }
}

static NSArray<NSNumber *> *DiscoverRFCOMMChannels(IOBluetoothDevice *device) {
  NSMutableOrderedSet<NSNumber *> *channels = [NSMutableOrderedSet orderedSet];
  NSArray *cachedServices = device.services ?: @[];
  AddSerialPortChannels(channels, cachedServices);
  if (channels.count > 0) return channels.array;

  MakeIdSDPDelegate *delegate = [MakeIdSDPDelegate new];
  IOBluetoothSDPUUID *serialPortUUID =
      [IOBluetoothSDPUUID
          uuid16:kBluetoothSDPUUID16ServiceClassSerialPort];
  IOReturn startStatus = [device performSDPQuery:delegate
                                           uuids:@[ serialPortUUID ]];
  if (startStatus != kIOReturnSuccess) return @[];

  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5.0];
  while (!delegate.finished && [deadline timeIntervalSinceNow] > 0) {
    [[NSRunLoop currentRunLoop]
        runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  }
  if (!delegate.finished) {
    // A timed-out SDP query can keep the Bluetooth serial service busy. Close
    // its base connection and let bluetoothd settle before the RFCOMM fallback.
    [device closeConnection];
    PumpRunLoop(1.5);
    return @[];
  }
  if (delegate.status != kIOReturnSuccess) return @[];

  NSArray *services = device.services ?: @[];
  AddSerialPortChannels(channels, services);
  return channels.array;
}

static NSString *IOReturnName(IOReturn status) {
  if (status == kIOReturnSuccess) return @"kIOReturnSuccess";
  if (status == kIOReturnError) return @"kIOReturnError";
  if (status == kIOReturnBusy) return @"kIOReturnBusy";
  if (status == kIOReturnExclusiveAccess) return @"kIOReturnExclusiveAccess";
  if (status == kIOReturnNotReady) return @"kIOReturnNotReady";
  if (status == kIOReturnNotResponding) return @"kIOReturnNotResponding";
  if (status == kIOReturnTimeout) return @"kIOReturnTimeout";
  return @"IOReturn";
}

static void SettleFailedChannel(IOBluetoothRFCOMMChannel *channel) {
  if (channel != nil) {
    [channel setDelegate:nil];
    [channel closeChannel];
  }
  PumpRunLoop(1.5);
}

static void Connect(NSString *deviceId) {
  IOBluetoothDevice *device = ResolveDevice(deviceId);
  PairDevice(device);

  NSMutableOrderedSet<NSNumber *> *candidateChannels =
      [NSMutableOrderedSet orderedSetWithArray:DiscoverRFCOMMChannels(device)];
  [candidateChannels addObject:@1];

  MakeIdRFCOMMBridge *bridge = nil;
  IOBluetoothRFCOMMChannel *channel = nil;
  IOReturn lastStatus = kIOReturnNotFound;
  BluetoothRFCOMMChannelID lastChannelID = 1;
  for (NSNumber *candidate in candidateChannels) {
    BluetoothRFCOMMChannelID channelID = candidate.unsignedCharValue;
    MakeIdRFCOMMBridge *attemptBridge = [MakeIdRFCOMMBridge new];
    IOBluetoothRFCOMMChannel *attemptChannel = nil;
    IOReturn status = [device openRFCOMMChannelSync:&attemptChannel
                                      withChannelID:channelID
                                           delegate:attemptBridge];
    if (attemptChannel != nil && !attemptChannel.isOpen) {
      // IOBluetooth can return kIOReturnError before the channel finishes its
      // asynchronous open. Keep the object and delegate alive while callbacks
      // run. Accept the channel if it opens during this bounded grace period.
      NSDate *lateOpenDeadline = [NSDate dateWithTimeIntervalSinceNow:2.5];
      while (!attemptChannel.isOpen &&
             [lateOpenDeadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop]
            runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
      }
    }
    if (attemptChannel != nil && attemptChannel.isOpen) {
      bridge = attemptBridge;
      channel = attemptChannel;
      break;
    }
    lastStatus = status;
    lastChannelID = channelID;
    SettleFailedChannel(attemptChannel);
  }

  if (channel == nil) {
    Fail([NSString stringWithFormat:
              @"Could not open RFCOMM channel %u (%@, 0x%08x)",
              lastChannelID, IOReturnName(lastStatus), (uint32_t)lastStatus],
         9);
  }
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
    Fail(@"Usage: makeid-bluetooth-helper discover | connect DEVICE_ID", 64);
  }
}
