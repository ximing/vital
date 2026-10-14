#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>

// Full access and the deprecated Authorized alias are both integer 3.
// Write-only is 4 and cannot read events. Naming the macOS 14 constant, or using
// an availability attribute, makes clang emit ___isPlatformVersionAtLeast. Rust links
// with -nodefaultlibs and does not resolve that compiler-rt symbol.
static const NSInteger kVitalCalendarReadAccess = 3;
static const NSInteger kVitalCalendarSyncDays = 8;
static const NSUInteger kVitalCalendarEventCap = 200;

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

// The dialog and the TCC registration only happen when this process calls
// EventKit on the main queue. A background request often never completes, so
// the app never appears under Privacy & Security → Calendars.
// Returns 2 when access was already granted, 1 when this call's dialog granted
// it, and 0 when it is still not granted. Callers wait off the main thread.
static int vital_request_on_main(void) {
    __block int result = 0;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            EKAuthorizationStatus status =
                [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
            if ((NSInteger)status == kVitalCalendarReadAccess) {
                result = 2;
                dispatch_semaphore_signal(sem);
                return;
            }
            // Denied, restricted, or write-only. Asking again does not list the app.
            if (status != EKAuthorizationStatusNotDetermined) {
                dispatch_semaphore_signal(sem);
                return;
            }
            // The store must outlive this block: the completion runs later.
            EKEventStore *store = [[EKEventStore alloc] init];
            VitalAccessCallback done = ^(BOOL ok, NSError *error) {
                (void)error;
                (void)store;
                result = ok ? 1 : 0;
                dispatch_semaphore_signal(sem);
            };
            // Calling this method through a function pointer returns granted=NO at
            // once and never shows the dialog. The real message send makes clang
            // emit the block-copy stub. Do not guard with an availability attribute;
            // that pulls in ___isPlatformVersionAtLeast, which this Rust link cannot resolve.
            NSOperatingSystemVersion version = [[NSProcessInfo processInfo] operatingSystemVersion];
            SEL full = @selector(requestFullAccessToEventsWithCompletion:);
            if (version.majorVersion >= 14 && [store respondsToSelector:full]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunguarded-availability-new"
                [store requestFullAccessToEventsWithCompletion:done];
#pragma clang diagnostic pop
            } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
                [store requestAccessToEntityType:EKEntityTypeEvent completion:done];
#pragma clang diagnostic pop
            }
        }
    });
    // Longer than a quick glance: the user is reading a system dialog.
    if (dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 180LL * NSEC_PER_SEC)) != 0) {
        return 0;
    }
    return result;
}

int vital_calendar_ensure_access(void) {
    if ([NSThread isMainThread]) {
        EKAuthorizationStatus status =
            [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
        return (NSInteger)status == kVitalCalendarReadAccess ? 2 : 0;
    }
    static dispatch_semaphore_t lock;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        lock = dispatch_semaphore_create(1);
    });
    dispatch_semaphore_wait(lock, DISPATCH_TIME_FOREVER);
    int result = vital_request_on_main();
    dispatch_semaphore_signal(lock);
    return result;
}

static NSString *vital_calendar_key(EKEvent *event, NSCalendar *cal) {
    NSString *stable = event.calendarItemExternalIdentifier;
    if (stable.length == 0) stable = event.eventIdentifier;
    if (stable.length == 0) return nil;
    BOOL recurring = event.hasRecurrenceRules || event.isDetached;
    NSString *suffix = @"";
    if (recurring) {
        NSDate *dayDate = event.occurrenceDate ?: event.startDate;
        if (dayDate == nil) return nil;
        NSDateComponents *parts = [cal components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay)
                                         fromDate:dayDate];
        suffix = [NSString stringWithFormat:@":%04ld-%02ld-%02ld",
                                            (long)parts.year, (long)parts.month, (long)parts.day];
    }
    NSString *head = @"mac:";
    NSUInteger budget = 200 - head.length - suffix.length;
    if (budget == 0) return nil;
    if (stable.length > budget) stable = [stable substringToIndex:budget];
    return [[head stringByAppendingString:stable] stringByAppendingString:suffix];
}

char *vital_calendar_today_json(char **error_out) {
    if (error_out) *error_out = NULL;
    if (vital_calendar_ensure_access() == 0) {
        if (error_out) *error_out = strdup("calendar-permission-denied");
        return NULL;
    }
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];

        NSCalendar *cal = [NSCalendar currentCalendar];
        NSDate *start = [cal startOfDayForDate:[NSDate date]];
        NSDate *end = [cal dateByAddingUnit:NSCalendarUnitDay value:kVitalCalendarSyncDays toDate:start options:0];
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
            if (rows.count >= kVitalCalendarEventCap) break;
            NSString *title = event.title ?: @"";
            if (title.length == 0 || event.startDate == nil) continue;
            NSString *startIso = [fmt stringFromDate:event.startDate] ?: @"";
            if (startIso.length == 0) continue;
            NSMutableDictionary *row = [NSMutableDictionary dictionaryWithDictionary:@{
                @"title" : title,
                @"start" : startIso,
                @"allDay" : @(event.isAllDay),
            }];
            NSString *key = vital_calendar_key(event, cal);
            if (key.length > 0) row[@"key"] = key;
            if (event.endDate != nil) {
                NSString *endIso = [fmt stringFromDate:event.endDate] ?: @"";
                if (endIso.length > 0) row[@"end"] = endIso;
            }
            [rows addObject:row];
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
