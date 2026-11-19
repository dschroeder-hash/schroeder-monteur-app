/// <summary>
/// Service orders (Service Header, Document Type = Order).
/// Read-only except "status" (PATCH with If-Match), which the Monteur-App sets after master approval.
/// </summary>
page 50100 "WS API Service Orders"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceOrder';
    EntitySetName = 'serviceOrders';
    EntityCaption = 'Service Order';
    EntitySetCaption = 'Service Orders';
    SourceTable = "Service Header";
    SourceTableView = where("Document Type" = const(Order));
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = false;
    DeleteAllowed = false;
    ModifyAllowed = true;
    ChangeTrackingAllowed = true;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Editable = false; }
                field(number; Rec."No.") { Editable = false; }
                field(description; Rec.Description) { Editable = false; }
                field(orderType; Rec."Service Order Type") { Editable = false; }
                // Only editable field; the page binding runs the standard status validation.
                field(status; Rec.Status) { }
                field(priority; Rec.Priority) { Editable = false; }
                field(orderDate; Rec."Order Date") { Editable = false; }
                // BC returns 0001-01-01 for blank dates; the connector maps it to null.
                field(responseDate; Rec."Response Date") { Editable = false; }
                field(customerNumber; Rec."Customer No.") { Editable = false; }
                field(customerName; Rec.Name) { Editable = false; }
                field(address; Rec.Address) { Editable = false; }
                field(address2; Rec."Address 2") { Editable = false; }
                field(postCode; Rec."Post Code") { Editable = false; }
                field(city; Rec.City) { Editable = false; }
                field(countryCode; Rec."Country/Region Code") { Editable = false; }
                field(contactName; Rec."Contact Name") { Editable = false; }
                field(phoneNumber; Rec."Phone No.") { Editable = false; }
                // Service Header has no dedicated mobile field; "Phone No. 2" is used (verify in tenant).
                field(mobilePhoneNumber; Rec."Phone No. 2") { Editable = false; }
                field(responsibilityCenter; Rec."Responsibility Center") { Editable = false; }
                field(locationCode; Rec."Location Code") { Editable = false; }
                field(workDescription; WorkDescription) { Editable = false; }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";
        WorkDescription: Text;

    trigger OnAfterGetRecord()
    var
        ServiceCommentLine: Record "Service Comment Line";
    begin
        // Service Header has no standard "Work Description" blob (unlike Sales Header).
        // Header-level comment lines of type General are used instead (see README).
        WorkDescription := ApiHelper.GetServiceOrderComments(Rec."No.", 0, ServiceCommentLine.Type::General);
    end;
}
