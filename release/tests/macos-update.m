// Exercise the same Sparkle runtime and Info.plist shipped in the website download.
#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>

@interface UpdateCheck : NSObject <SPUUpdaterDelegate>
@property(nonatomic) BOOL finished;
@property(nonatomic) BOOL newer;
@property(nonatomic,strong) NSError *error;
@end

@implementation UpdateCheck
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {
    self.newer = YES;
    NSLog(@"Newer public build %@", item.versionString);
}
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
    self.error = error;
    self.finished = YES;
}
@end

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
        [NSApplication sharedApplication];
        NSBundle *bundle = NSBundle.mainBundle;
        UpdateCheck *result = [UpdateCheck new];
        SPUStandardUserDriver *driver = [[SPUStandardUserDriver alloc] initWithHostBundle:bundle delegate:nil];
        SPUUpdater *updater = [[SPUUpdater alloc] initWithHostBundle:bundle applicationBundle:bundle userDriver:driver delegate:result];
        NSError *error = nil;
        if (![updater startUpdater:&error]) { NSLog(@"%@", error); return 1; }
        if (strcmp(argv[1], "configuration") == 0) return 0;

        [updater checkForUpdateInformation];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:35];
        while (!result.finished && deadline.timeIntervalSinceNow > 0) {
            [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        }
        BOOL noUpdate = [result.error.domain isEqualToString:SUSparkleErrorDomain] && result.error.code == SUNoUpdateError;
        if (result.error && !noUpdate) NSLog(@"%@", result.error);
        BOOL expectNewer = strcmp(argv[1], "older") == 0;
        return (result.finished && (!result.error || noUpdate) && result.newer == expectNewer) ? 0 : 1;
    }
}
