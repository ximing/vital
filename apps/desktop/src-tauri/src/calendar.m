#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#import <objc/message.h>
#include <stdlib.h>
#include <string.h>

// EKAuthorizationStatusFullAccess and the deprecated Authorized alias are both 3.
// Write-only is 4 and cannot read events. Naming the macOS 14 constant, or using
// @available, makes clang emit ___isPlatformVersionAtLeast. Rust links with
// -nodefaultlibs and does not resolve that compiler-rt symbol.
static const NSInteger kVitalCalendarReadAccess = 3;

typedef void (^VitalAccessCallback)(BOOL granted, NSError *error);

static char *vital_dup(NSString *text) {
    const char *utf = text.UTF8String;
    if (!utf) return NULL;
    size_t len = strlen(utf);
    char *copy = malloc(len + 1);
    if (!copy) return NULL;
    memcpy(copy, utf, len + 1);
    return copy;
}

void vital_calendar_string_free(char *ptr) { free(ptr); }

static BOOL vital_wait_access(EKEventStore *store) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block BOOL granted = NO;
    VitalAccessCallback done = ^(BOOL ok, NSError *error) {
        (void)error;
        granted = ok;
        dispatch_semaphore_signal(sem);
    };
    NSOperatingSystemVersion version = [[NSProcessInfo processInfo] operatingSystemVersion];
    SEL full = @selector(requestFullAccessToEventsWithCompletion:);
    if (version.majorVersion >= 14 && [store respondsToSelector:full]) {
        void (*send)(id, SEL, VitalAccessCallback) = (void (*)(id, SEL, VitalAccessCallback))objc_msgSend;
        send(store, full, done);
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        [store requestAccessToEntityType:EKEntityTypeEvent completion:done];
#pragma clang diagnostic pop
    }
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC));
    return granted;
}

char *vital_calendar_today_json(char **error_out) {
    if (error_out) *error_out = NULL;
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
        BOOL allowed = (NSInteger)status == kVitalCalendarReadAccess;
        if (status == EKAuthorizationStatusNotDetermined) {
            allowed = vital_wait_access(store);
        }
        if (!allowed) {
            if (error_out) *error_out = strdup("calendar-permission-denied");
            return NULL;
        }

        NSCalendar *cal = [NSCalendar currentCalendar];
        NSDate *start = [cal startOfDayForDate:[NSDate date]];
        NSDate *end = [cal dateByAddingUnit:NSCalendarUnitDay value:1 toDate:start options:0];
        NSPredicate *predicate = [store predicateForEventsWithStartDate:start endDate:end calendars:nil];
        NSArray<EKEvent *> *events = [[store eventsMatchingPredicate:predicate]
            sortedArrayUsingComparator:^NSComparisonResult(EKEvent *a, EKEvent *b) {
                return [a.startDate compare:b.startDate];
            }];

        NSISO8601DateFormatter *fmt = [[NSISO8601DateFormatter alloc] init];
        fmt.formatOptions = NSISO8601DateFormatWithInternetDateTime;
        fmt.timeZone = [NSTimeZone localTimeZone];

        NSMutableArray *rows = [NSMutableArray array];
        for (EKEvent *event in events) {
            if (rows.count >= 40) break;
            NSString *title = event.title ?: @"";
            if (title.length == 0 || event.startDate == nil) continue;
            NSString *startIso = [fmt stringFromDate:event.startDate] ?: @"";
            if (startIso.length == 0) continue;
            [rows addObject:@{
                @"title" : title,
                @"start" : startIso,
                @"allDay" : @(event.isAllDay),
            }];
        }

        NSData *data = [NSJSONSerialization dataWithJSONObject:rows options:0 error:nil];
        if (!data) {
            if (error_out) *error_out = strdup("calendar-failed");
            return NULL;
        }
        NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        return vital_dup(json ?: @"[]");
    }
}
