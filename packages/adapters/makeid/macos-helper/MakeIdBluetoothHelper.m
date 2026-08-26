#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
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

- (void)remoteNameRequestComplete:(IOBluetoothDevice *)device
                            status:(IOReturn)status {
}

- (void)connectionComplete:(IOBluetoothDevice *)device
                     status:(IOReturn)status {
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

static NSString *const MakeIdBLEDevicePrefix = @"macos-ble-";

static CBUUID *MakeIdServiceUUID(void) {
  return [CBUUID UUIDWithString:@"ABF0"];
}

static CBUUID *MakeIdWriteUUID(void) {
  return [CBUUID UUIDWithString:@"ABF1"];
}

static CBUUID *MakeIdNotifyUUID(void) {
  return [CBUUID UUIDWithString:@"ABF2"];
}

static NSString *BLEIdentifier(CBPeripheral *peripheral) {
  NSString *uuid = peripheral.identifier.UUIDString.lowercaseString;
  if (uuid.length == 0) return nil;
  return [MakeIdBLEDevicePrefix stringByAppendingString:uuid];
}

static NSUUID *ParseBLEIdentifier(NSString *deviceId) {
  if (![deviceId hasPrefix:MakeIdBLEDevicePrefix]) return nil;
  NSString *suffix = [deviceId substringFromIndex:MakeIdBLEDevicePrefix.length];
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:suffix];
  if (uuid == nil) return nil;
  NSString *canonical = uuid.UUIDString.lowercaseString;
  if (![canonical isEqualToString:suffix.lowercaseString]) return nil;
  return uuid;
}

static BOOL IsMakeIdBLEName(NSString *name) {
  if (name.length == 0) return NO;
  NSString *normalized = name.uppercaseString;
  if ([normalized hasPrefix:@"YICHIPFPGA-"] ||
      [normalized isEqualToString:@"MAKEID E1"] ||
      [normalized hasPrefix:@"MAKEID E1-"]) {
    return YES;
  }
  if (normalized.length != 10 || ![normalized hasPrefix:@"E1"]) return NO;
  NSCharacterSet *digits =
      [NSCharacterSet characterSetWithCharactersInString:@"0123456789"];
  NSCharacterSet *letters =
      [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  NSString *firstDigits = [normalized substringWithRange:NSMakeRange(2, 2)];
  NSString *modelLetter = [normalized substringWithRange:NSMakeRange(4, 1)];
  NSString *lastDigits = [normalized substringWithRange:NSMakeRange(5, 5)];
  return [firstDigits rangeOfCharacterFromSet:digits.invertedSet].location ==
             NSNotFound &&
         [modelLetter rangeOfCharacterFromSet:letters.invertedSet].location ==
             NSNotFound &&
         [lastDigits rangeOfCharacterFromSet:digits.invertedSet].location ==
             NSNotFound;
}

typedef NS_ENUM(NSUInteger, MakeIdBLEPhase) {
  MakeIdBLEPhaseIdle,
  MakeIdBLEPhaseScanning,
  MakeIdBLEPhaseConnecting,
  MakeIdBLEPhaseDiscoveringServices,
  MakeIdBLEPhaseDiscoveringCharacteristics,
  MakeIdBLEPhaseEnablingNotifications,
  MakeIdBLEPhaseReady,
};

@interface MakeIdBLEBridge : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate>
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, strong) CBPeripheral *peripheral;
@property(nonatomic, strong) CBCharacteristic *writeCharacteristic;
@property(nonatomic, strong) CBCharacteristic *notifyCharacteristic;
@property(nonatomic, strong)
    NSMutableDictionary<NSString *, NSMutableDictionary *> *devices;
@property(nonatomic, strong) NSMutableData *pendingWriteData;
@property(nonatomic, copy) NSString *targetIdentifier;
@property(nonatomic, copy) NSString *errorMessage;
@property(nonatomic) CBCharacteristicWriteType writeType;
@property(nonatomic) BOOL poweredOn;
@property(nonatomic) BOOL scanning;
@property(nonatomic) BOOL ready;
@property(nonatomic) BOOL closed;
@property(nonatomic) BOOL failed;
@property(nonatomic) BOOL tearingDown;
@property(nonatomic) BOOL disconnectComplete;
@property(nonatomic) BOOL notificationDisableComplete;
@property(nonatomic) BOOL inputEnded;
@property(nonatomic) BOOL writeInFlight;
@property(nonatomic) NSUInteger writeInFlightLength;
@property(nonatomic) BOOL closeScheduled;
@property(nonatomic) BOOL reconnectEnabled;
@property(nonatomic) BOOL reconnecting;
@property(nonatomic) BOOL connectionInProgress;
@property(nonatomic) NSUInteger connectionAttemptGeneration;
@property(nonatomic) MakeIdBLEPhase phase;
- (void)recordPeripheral:(CBPeripheral *)peripheral
       advertisementData:(NSDictionary<NSString *, id> *)advertisementData;
- (void)enqueueWriteData:(NSData *)data;
- (void)endInput;
- (void)drainWrites;
- (void)failWithMessage:(NSString *)message;
- (void)startReconnectScan;
- (void)connectForReconnect:(CBPeripheral *)peripheral;
- (void)recoverOrFailWithMessage:(NSString *)message;
@end

@implementation MakeIdBLEBridge

- (instancetype)init {
  self = [super init];
  if (self) {
    _devices = [NSMutableDictionary dictionary];
    _pendingWriteData = [NSMutableData data];
    _writeType = CBCharacteristicWriteWithoutResponse;
  }
  return self;
}

- (void)failWithMessage:(NSString *)message {
  if (self.failed || self.tearingDown) return;
  self.errorMessage = message;
  self.failed = YES;
  self.closed = YES;
}

- (void)resetConnectionState {
  self.ready = NO;
  self.writeCharacteristic = nil;
  self.notifyCharacteristic = nil;
  self.writeInFlight = NO;
  self.writeInFlightLength = 0;
  self.notificationDisableComplete = NO;
  self.phase = MakeIdBLEPhaseIdle;
}

- (void)startReconnectScan {
  if (!self.reconnectEnabled || self.tearingDown || self.failed || self.closed) {
    return;
  }
  if (self.inputEnded) {
    self.closed = YES;
    return;
  }
  [self resetConnectionState];
  self.reconnecting = YES;
  self.connectionInProgress = NO;
  self.connectionAttemptGeneration += 1;
  if (!self.poweredOn) return;
  if (self.scanning) {
    self.phase = MakeIdBLEPhaseScanning;
    return;
  }
  self.scanning = YES;
  self.phase = MakeIdBLEPhaseScanning;
  [self.central scanForPeripheralsWithServices:nil
                                       options:@{
                                         CBCentralManagerScanOptionAllowDuplicatesKey :
                                             @NO
                                       }];
}

- (void)connectForReconnect:(CBPeripheral *)peripheral {
  if (!self.reconnectEnabled || !self.reconnecting ||
      self.connectionInProgress || self.inputEnded || self.tearingDown ||
      self.failed || self.closed) {
    return;
  }
  if (self.scanning) [self.central stopScan];
  self.scanning = NO;
  self.disconnectComplete = NO;
  self.peripheral = peripheral;
  peripheral.delegate = self;
  self.connectionInProgress = YES;
  self.phase = MakeIdBLEPhaseConnecting;
  self.connectionAttemptGeneration += 1;
  NSUInteger generation = self.connectionAttemptGeneration;
  [self.central connectPeripheral:peripheral options:nil];
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15.0 * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        if (self.connectionAttemptGeneration != generation || self.ready ||
            !self.connectionInProgress || !self.reconnectEnabled ||
            self.inputEnded || self.tearingDown || self.failed || self.closed) {
          return;
        }
        self.connectionInProgress = NO;
        self.connectionAttemptGeneration += 1;
        if (peripheral.state != CBPeripheralStateDisconnected) {
          [self.central cancelPeripheralConnection:peripheral];
        }
        [self startReconnectScan];
      });
}

- (void)recoverOrFailWithMessage:(NSString *)message {
  if (!self.reconnectEnabled) {
    [self failWithMessage:message];
    return;
  }
  [self resetConnectionState];
  self.reconnecting = YES;
  self.connectionInProgress = NO;
  self.connectionAttemptGeneration += 1;
  if (self.inputEnded) {
    self.closed = YES;
    return;
  }
  if (self.peripheral != nil &&
      self.peripheral.state != CBPeripheralStateDisconnected) {
    [self.central cancelPeripheralConnection:self.peripheral];
  }
  [self startReconnectScan];
}

- (void)recordPeripheral:(CBPeripheral *)peripheral
       advertisementData:(NSDictionary<NSString *, id> *)advertisementData {
  NSString *deviceId = BLEIdentifier(peripheral);
  if (deviceId.length == 0) return;

  NSMutableDictionary *entry = self.devices[deviceId];
  if (entry == nil) {
    entry = [@{ @"id" : deviceId } mutableCopy];
    self.devices[deviceId] = entry;
  }
  NSString *advertisedName = advertisementData[CBAdvertisementDataLocalNameKey];
  NSString *name = advertisedName.length > 0 ? advertisedName : peripheral.name;
  if (name.length > 0) entry[@"name"] = name;

  if (self.targetIdentifier.length > 0 && !self.connectionInProgress &&
      [peripheral.identifier.UUIDString.lowercaseString
          isEqualToString:self.targetIdentifier]) {
    self.peripheral = peripheral;
  }
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  self.poweredOn = central.state == CBManagerStatePoweredOn;
  if (central.state == CBManagerStateUnsupported) {
    [self failWithMessage:@"This Mac does not support Bluetooth Low Energy."];
  } else if (central.state == CBManagerStateUnauthorized) {
    [self failWithMessage:
              @"Bluetooth access is not allowed. Allow Bluetooth access for "
               "Labelmaker, then try again."];
  } else if (central.state != CBManagerStatePoweredOn) {
    if (self.reconnectEnabled) {
      self.scanning = NO;
      [self resetConnectionState];
      self.reconnecting = YES;
      self.connectionInProgress = NO;
      self.connectionAttemptGeneration += 1;
    } else {
      if (central.state == CBManagerStatePoweredOff) {
        [self failWithMessage:
                  @"Bluetooth is off. Turn on Bluetooth, then try again."];
      }
    }
  } else if (central.state == CBManagerStatePoweredOn &&
             self.reconnectEnabled && !self.ready) {
    [self startReconnectScan];
  }
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *, id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
  NSString *advertisedName = advertisementData[CBAdvertisementDataLocalNameKey];
  NSString *name = advertisedName.length > 0 ? advertisedName : peripheral.name;
  BOOL isSavedTarget =
      self.targetIdentifier.length > 0 &&
      [peripheral.identifier.UUIDString.lowercaseString
          isEqualToString:self.targetIdentifier];
  if (isSavedTarget || IsMakeIdBLEName(name)) {
    [self recordPeripheral:peripheral advertisementData:advertisementData];
  }
  if (isSavedTarget && self.reconnectEnabled && self.reconnecting &&
      !self.connectionInProgress && !self.inputEnded && !self.tearingDown &&
      !self.closed) {
    [self connectForReconnect:peripheral];
  }
}

- (void)centralManager:(CBCentralManager *)central
    didConnectPeripheral:(CBPeripheral *)peripheral {
  if (self.peripheral != nil && peripheral != self.peripheral) {
    [central cancelPeripheralConnection:peripheral];
    return;
  }
  if (self.phase != MakeIdBLEPhaseConnecting) return;
  if (self.scanning) [central stopScan];
  self.scanning = NO;
  self.peripheral = peripheral;
  peripheral.delegate = self;
  [self resetConnectionState];
  self.phase = MakeIdBLEPhaseDiscoveringServices;
  [peripheral discoverServices:@[ MakeIdServiceUUID() ]];
}

- (void)centralManager:(CBCentralManager *)central
    didFailToConnectPeripheral:(CBPeripheral *)peripheral
                         error:(NSError *)error {
  if (peripheral != self.peripheral) return;
  self.connectionInProgress = NO;
  self.connectionAttemptGeneration += 1;
  [self recoverOrFailWithMessage:
            @"Could not connect to the Bluetooth printer."];
}

- (void)centralManager:(CBCentralManager *)central
    didDisconnectPeripheral:(CBPeripheral *)peripheral
                       error:(NSError *)error {
  if (peripheral != self.peripheral) return;
  self.disconnectComplete = YES;
  self.connectionInProgress = NO;
  self.connectionAttemptGeneration += 1;
  if (self.tearingDown) {
    self.closed = YES;
    return;
  }
  if (self.inputEnded) {
    self.closed = YES;
  } else if (self.reconnectEnabled) {
    [self startReconnectScan];
  } else {
    [self failWithMessage:self.ready
                              ? @"The Bluetooth printer disconnected."
                              : @"Could not prepare the Bluetooth printer."];
  }
}

- (void)peripheral:(CBPeripheral *)peripheral
    didDiscoverServices:(NSError *)error {
  if (peripheral != self.peripheral ||
      peripheral.state != CBPeripheralStateConnected ||
      self.phase != MakeIdBLEPhaseDiscoveringServices) {
    return;
  }
  if (error != nil) {
    [self recoverOrFailWithMessage:
              @"Could not find the printer Bluetooth service."];
    return;
  }
  CBService *makeIdService = nil;
  for (CBService *service in peripheral.services ?: @[]) {
    if ([service.UUID isEqual:MakeIdServiceUUID()]) {
      makeIdService = service;
      break;
    }
  }
  if (makeIdService == nil) {
    [self recoverOrFailWithMessage:
              @"The selected device does not provide the MakeID service."];
    return;
  }
  [peripheral discoverCharacteristics:
                  @[ MakeIdWriteUUID(), MakeIdNotifyUUID() ]
                              forService:makeIdService];
  self.phase = MakeIdBLEPhaseDiscoveringCharacteristics;
}

- (void)peripheral:(CBPeripheral *)peripheral
    didDiscoverCharacteristicsForService:(CBService *)service
                                    error:(NSError *)error {
  if (peripheral != self.peripheral ||
      peripheral.state != CBPeripheralStateConnected ||
      self.phase != MakeIdBLEPhaseDiscoveringCharacteristics) {
    return;
  }
  if (error != nil) {
    [self recoverOrFailWithMessage:
              @"Could not prepare the printer Bluetooth service."];
    return;
  }
  for (CBCharacteristic *characteristic in service.characteristics ?: @[]) {
    if ([characteristic.UUID isEqual:MakeIdWriteUUID()]) {
      self.writeCharacteristic = characteristic;
    }
    if ([characteristic.UUID isEqual:MakeIdNotifyUUID()]) {
      self.notifyCharacteristic = characteristic;
    }
  }
  if (self.writeCharacteristic == nil || self.notifyCharacteristic == nil) {
    [self recoverOrFailWithMessage:
              @"The printer Bluetooth service is incomplete."];
    return;
  }

  CBCharacteristicProperties writeProperties =
      self.writeCharacteristic.properties;
  BOOL canWriteWithoutResponse =
      (writeProperties & CBCharacteristicPropertyWriteWithoutResponse) != 0;
  BOOL canWriteWithResponse =
      (writeProperties & CBCharacteristicPropertyWrite) != 0;
  if (!canWriteWithoutResponse && !canWriteWithResponse) {
    [self recoverOrFailWithMessage:
              @"The printer Bluetooth write channel is not usable."];
    return;
  }
  CBCharacteristicProperties notifyProperties =
      self.notifyCharacteristic.properties;
  if ((notifyProperties &
       (CBCharacteristicPropertyNotify | CBCharacteristicPropertyIndicate)) ==
      0) {
    [self recoverOrFailWithMessage:
              @"The printer Bluetooth reply channel is not usable."];
    return;
  }

  self.writeType = canWriteWithoutResponse
                       ? CBCharacteristicWriteWithoutResponse
                       : CBCharacteristicWriteWithResponse;
  self.phase = MakeIdBLEPhaseEnablingNotifications;
  [peripheral setNotifyValue:YES forCharacteristic:self.notifyCharacteristic];
}

- (void)peripheral:(CBPeripheral *)peripheral
    didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic
                                           error:(NSError *)error {
  if (peripheral != self.peripheral) return;
  if (characteristic != self.notifyCharacteristic) return;
  if (self.tearingDown) {
    if (error != nil || !characteristic.isNotifying) {
      self.notificationDisableComplete = YES;
    }
    return;
  }
  if (self.phase != MakeIdBLEPhaseEnablingNotifications) return;
  if (error != nil || !characteristic.isNotifying) {
    [self recoverOrFailWithMessage:
              @"Could not enable printer Bluetooth replies."];
    return;
  }
  self.ready = YES;
  self.phase = MakeIdBLEPhaseReady;
  self.reconnecting = NO;
  self.connectionInProgress = NO;
  self.connectionAttemptGeneration += 1;
  [self drainWrites];
}

- (void)peripheral:(CBPeripheral *)peripheral
    didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic
                               error:(NSError *)error {
  if (peripheral != self.peripheral || self.phase != MakeIdBLEPhaseReady) {
    return;
  }
  if (characteristic != self.notifyCharacteristic) return;
  if (error != nil) {
    [self recoverOrFailWithMessage:
              @"Could not read the printer Bluetooth reply."];
    return;
  }
  NSData *value = characteristic.value;
  if (value.length > 0) {
    [[NSFileHandle fileHandleWithStandardOutput] writeData:value];
  }
}

- (void)enqueueWriteData:(NSData *)data {
  if (data.length == 0 || self.closed || self.failed) return;
  [self.pendingWriteData appendData:data];
  [self drainWrites];
}

- (void)endInput {
  self.inputEnded = YES;
  self.reconnectEnabled = NO;
  self.reconnecting = NO;
  self.connectionInProgress = NO;
  self.connectionAttemptGeneration += 1;
  if (self.scanning) [self.central stopScan];
  self.scanning = NO;
  if (!self.ready) {
    self.phase = MakeIdBLEPhaseIdle;
    [self.pendingWriteData setLength:0];
    self.closed = YES;
    return;
  }
  [self drainWrites];
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5.0 * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        if (self.inputEnded && !self.closed && !self.failed) {
          [self.pendingWriteData setLength:0];
          self.writeInFlight = NO;
          self.writeInFlightLength = 0;
          self.phase = MakeIdBLEPhaseIdle;
          self.closed = YES;
        }
      });
}

- (void)drainWrites {
  if (!self.ready || self.failed || self.closed || self.peripheral == nil ||
      self.writeCharacteristic == nil) {
    return;
  }
  NSUInteger maximumLength =
      [self.peripheral maximumWriteValueLengthForType:self.writeType];
  if (maximumLength == 0) {
    [self recoverOrFailWithMessage:
              @"The printer Bluetooth write size is invalid."];
    return;
  }
  if (self.writeType == CBCharacteristicWriteWithResponse) {
    if (!self.writeInFlight && self.pendingWriteData.length > 0) {
      NSUInteger length = MIN(maximumLength, self.pendingWriteData.length);
      NSData *next =
          [self.pendingWriteData subdataWithRange:NSMakeRange(0, length)];
      self.writeInFlight = YES;
      self.writeInFlightLength = length;
      [self.peripheral writeValue:next
                forCharacteristic:self.writeCharacteristic
                             type:CBCharacteristicWriteWithResponse];
    }
  } else {
    while (self.pendingWriteData.length > 0 &&
           self.peripheral.canSendWriteWithoutResponse) {
      NSUInteger length = MIN(maximumLength, self.pendingWriteData.length);
      NSData *next =
          [self.pendingWriteData subdataWithRange:NSMakeRange(0, length)];
      [self.pendingWriteData replaceBytesInRange:NSMakeRange(0, length)
                                       withBytes:NULL
                                          length:0];
      [self.peripheral writeValue:next
                forCharacteristic:self.writeCharacteristic
                             type:CBCharacteristicWriteWithoutResponse];
    }
  }
  if (self.inputEnded && self.pendingWriteData.length == 0 &&
      !self.writeInFlight) {
    if (self.writeType == CBCharacteristicWriteWithResponse) {
      self.closed = YES;
    } else if (!self.closeScheduled) {
      // CoreBluetooth does not report completion for writes without response.
      // Allow its accepted write queue to reach the controller before close.
      self.closeScheduled = YES;
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)),
          dispatch_get_main_queue(), ^{
            self.closeScheduled = NO;
            if (self.inputEnded && self.pendingWriteData.length == 0 &&
                !self.writeInFlight && !self.failed) {
              self.closed = YES;
            } else {
              [self drainWrites];
            }
          });
    }
  }
}

- (void)peripheral:(CBPeripheral *)peripheral
    didWriteValueForCharacteristic:(CBCharacteristic *)characteristic
                             error:(NSError *)error {
  if (peripheral != self.peripheral || !self.ready) return;
  if (characteristic != self.writeCharacteristic ||
      self.writeType != CBCharacteristicWriteWithResponse) {
    return;
  }
  self.writeInFlight = NO;
  if (error != nil) {
    self.writeInFlightLength = 0;
    [self recoverOrFailWithMessage:@"The printer Bluetooth write failed."];
    return;
  }
  if (self.writeInFlightLength > 0 &&
      self.writeInFlightLength <= self.pendingWriteData.length) {
    [self.pendingWriteData
        replaceBytesInRange:NSMakeRange(0, self.writeInFlightLength)
                  withBytes:NULL
                     length:0];
  }
  self.writeInFlightLength = 0;
  [self drainWrites];
}

- (void)peripheralIsReadyToSendWriteWithoutResponse:(CBPeripheral *)peripheral {
  if (peripheral != self.peripheral || !self.ready) return;
  [self drainWrites];
}

@end

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

static void WaitForBLEPower(MakeIdBLEBridge *bridge,
                            NSTimeInterval timeoutSeconds) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:timeoutSeconds];
  while (!bridge.poweredOn && !bridge.failed &&
         [deadline timeIntervalSinceNow] > 0) {
    [[NSRunLoop currentRunLoop]
        runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  }
  if (!bridge.poweredOn && !bridge.failed) {
    [bridge failWithMessage:@"Bluetooth did not become ready in time."];
  }
}

static void DiscoverBLE(BOOL includeUnpaired) {
  // CoreBluetooth does not expose a public paired-device list. Default
  // discovery returns connected ABF0 peripherals only. Add Printer scans all
  // BLE advertisements because the E1 does not advertise ABF0, then accepts
  // only strict MakeID E1 names. Connection still validates ABF0.
  MakeIdBLEBridge *bridge = [MakeIdBLEBridge new];
  bridge.central = [[CBCentralManager alloc]
      initWithDelegate:bridge
                 queue:nil
               options:@{ CBCentralManagerOptionShowPowerAlertKey : @NO }];
  WaitForBLEPower(bridge, 1.5);
  if (bridge.failed) {
    NSString *message = bridge.errorMessage ?: @"Bluetooth is not ready.";
    bridge.central.delegate = nil;
    Fail(message, 2);
  }

  for (CBPeripheral *peripheral in
       [bridge.central retrieveConnectedPeripheralsWithServices:
                           @[ MakeIdServiceUUID() ]]) {
    if (IsMakeIdBLEName(peripheral.name)) {
      [bridge recordPeripheral:peripheral advertisementData:@{}];
    }
  }

  if (includeUnpaired) {
    bridge.scanning = YES;
    [bridge.central scanForPeripheralsWithServices:nil
                                           options:@{
                                             CBCentralManagerScanOptionAllowDuplicatesKey :
                                                 @NO
                                           }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:3.0];
    while (!bridge.failed && [deadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop]
          runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    if (bridge.scanning) [bridge.central stopScan];
    bridge.scanning = NO;
  }

  if (bridge.failed) {
    NSString *message = bridge.errorMessage ?: @"Bluetooth discovery failed.";
    bridge.central.delegate = nil;
    Fail(message, 2);
  }

  NSMutableArray *result =
      [NSMutableArray arrayWithArray:bridge.devices.allValues];
  [result sortUsingComparator:^NSComparisonResult(NSDictionary *left,
                                                   NSDictionary *right) {
    return [left[@"id"] compare:right[@"id"]];
  }];
  NSError *error = nil;
  NSData *json =
      [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
  bridge.central.delegate = nil;
  if (json == nil) Fail(@"Could not encode Bluetooth printer results.", 2);
  [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
}

static void TearDownBLE(MakeIdBLEBridge *bridge, NSFileHandle *input) {
  input.readabilityHandler = nil;
  bridge.tearingDown = YES;
  bridge.reconnectEnabled = NO;
  bridge.reconnecting = NO;
  bridge.connectionInProgress = NO;
  bridge.connectionAttemptGeneration += 1;
  if (bridge.scanning) [bridge.central stopScan];
  bridge.scanning = NO;
  if (bridge.notifyCharacteristic.isNotifying && bridge.peripheral != nil &&
      bridge.peripheral.state == CBPeripheralStateConnected) {
    [bridge.peripheral setNotifyValue:NO
                    forCharacteristic:bridge.notifyCharacteristic];
    NSDate *notifyDeadline = [NSDate dateWithTimeIntervalSinceNow:0.6];
    while (!bridge.notificationDisableComplete &&
           bridge.notifyCharacteristic.isNotifying &&
           [notifyDeadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop]
          runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
  }
  if (bridge.peripheral != nil &&
      bridge.peripheral.state != CBPeripheralStateDisconnected) {
    [bridge.central cancelPeripheralConnection:bridge.peripheral];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1.0];
    while (!bridge.disconnectComplete &&
           bridge.peripheral.state != CBPeripheralStateDisconnected &&
           [deadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop]
          runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
  }
  bridge.peripheral.delegate = nil;
  bridge.central.delegate = nil;
}

static void ConnectBLE(NSString *deviceId) {
  NSUUID *uuid = ParseBLEIdentifier(deviceId);
  if (uuid == nil) Fail(@"The saved Bluetooth printer ID is invalid.", 3);

  MakeIdBLEBridge *bridge = [MakeIdBLEBridge new];
  bridge.targetIdentifier = uuid.UUIDString.lowercaseString;
  bridge.central = [[CBCentralManager alloc]
      initWithDelegate:bridge
                 queue:nil
               options:@{ CBCentralManagerOptionShowPowerAlertKey : @NO }];
  WaitForBLEPower(bridge, 1.5);

  if (!bridge.failed && bridge.peripheral == nil) {
    NSArray<CBPeripheral *> *known =
        [bridge.central retrievePeripheralsWithIdentifiers:@[ uuid ]];
    if (known.count > 0) bridge.peripheral = known.firstObject;
  }

  if (!bridge.failed && bridge.peripheral == nil) {
    // The E1 does not advertise ABF0, so the saved-target fallback scan must
    // use nil services. It accepts only the requested peripheral UUID.
    bridge.scanning = YES;
    [bridge.central scanForPeripheralsWithServices:nil
                                           options:@{
                                             CBCentralManagerScanOptionAllowDuplicatesKey :
                                                 @NO
                                           }];
    NSDate *scanDeadline = [NSDate dateWithTimeIntervalSinceNow:3.0];
    while (bridge.peripheral == nil && !bridge.failed &&
           [scanDeadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop]
          runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    if (bridge.scanning) [bridge.central stopScan];
    bridge.scanning = NO;
  }

  if (!bridge.failed && bridge.peripheral == nil) {
    [bridge failWithMessage:@"The saved Bluetooth printer is not available."];
  }

  if (!bridge.failed) {
    bridge.phase = MakeIdBLEPhaseConnecting;
    [bridge.central connectPeripheral:bridge.peripheral options:nil];
    NSDate *readyDeadline = [NSDate dateWithTimeIntervalSinceNow:13.0];
    while (!bridge.ready && !bridge.failed &&
           [readyDeadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop]
          runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    if (!bridge.ready && !bridge.failed) {
      [bridge failWithMessage:
                  @"The Bluetooth printer did not become ready in time."];
    }
  }

  if (bridge.failed) {
    NSString *message = bridge.errorMessage ?: @"Bluetooth connection failed.";
    TearDownBLE(bridge, [NSFileHandle fileHandleWithStandardInput]);
    Fail(message, 9);
  }

  [[NSFileHandle fileHandleWithStandardError]
      writeData:[@"READY\n" dataUsingEncoding:NSUTF8StringEncoding]];
  bridge.reconnectEnabled = YES;

  NSFileHandle *input = [NSFileHandle fileHandleWithStandardInput];
  __weak MakeIdBLEBridge *weakBridge = bridge;
  input.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    dispatch_async(dispatch_get_main_queue(), ^{
      MakeIdBLEBridge *strongBridge = weakBridge;
      if (strongBridge == nil) return;
      if (data.length == 0) {
        [strongBridge endInput];
      } else {
        [strongBridge enqueueWriteData:data];
      }
    });
  };

  while (!bridge.closed && !bridge.failed) {
    [[NSRunLoop currentRunLoop]
        runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  }
  NSString *failureMessage = bridge.errorMessage;
  BOOL failed = bridge.failed;
  TearDownBLE(bridge, input);
  if (failed) {
    Fail(failureMessage ?: @"The Bluetooth printer connection failed.", 9);
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

static void ConnectClassic(NSString *deviceId) {
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
      DiscoverBLE(includeUnpaired);
      return 0;
    }
    if (argc == 3 && strcmp(argv[1], "connect") == 0) {
      NSString *deviceId = [NSString stringWithUTF8String:argv[2]];
      if ([deviceId hasPrefix:MakeIdBLEDevicePrefix]) {
        ConnectBLE(deviceId);
      } else if (IsOpaqueDeviceId(deviceId)) {
        ConnectClassic(deviceId);
      } else {
        Fail(@"The saved Bluetooth printer ID is invalid.", 3);
      }
      return 0;
    }
    Fail(@"Usage: makeid-bluetooth-helper discover | connect DEVICE_ID", 64);
  }
}
