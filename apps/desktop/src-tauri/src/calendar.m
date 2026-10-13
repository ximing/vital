#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>

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
    if (@available(macOS 14.0, *)) {
        [store requestFullAccessToEventsWithCompletion:^(BOOL ok, NSError *error) {
            (void)error;
            granted = ok;
            dispatch_semaphore_signal(sem);
        }];
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        [store requestAccessToEntityType:EKEntityTypeEvent
                               completion:^(BOOL ok, NSError *error) {
                                   (void)error;
                                   granted = ok;
                                   dispatch_semaphore_signal(sem);
                               }];
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
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        BOOL allowed = status == EKAuthorizationStatusFullAccess || status == EKAuthorizationStatusAuthorized;
#pragma clang diagnostic pop
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
