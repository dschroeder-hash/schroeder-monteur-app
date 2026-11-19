/// <summary>
/// Service item lines of service orders (machine on the order).
/// </summary>
page 50101 "WS API Service Order Items"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceOrderItem';
    EntitySetName = 'serviceOrderItems';
    EntityCaption = 'Service Order Item';
    EntitySetCaption = 'Service Order Items';
    SourceTable = "Service Item Line";
    SourceTableView = where("Document Type" = const(Order));
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    ChangeTrackingAllowed = true;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { }
                field(documentNumber; Rec."Document No.") { }
                field(lineNumber; Rec."Line No.") { }
                field(serviceItemNumber; Rec."Service Item No.") { }
                field(itemNumber; Rec."Item No.") { }
                field(serialNumber; Rec."Serial No.") { }
                field(description; Rec.Description) { }
                field(faultComment; FaultComment) { }
                field(repairStatusCode; Rec."Repair Status Code") { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";
        FaultComment: Text;

    trigger OnAfterGetRecord()
    var
        ServiceCommentLine: Record "Service Comment Line";
    begin
        // "Fault Comment" on Service Item Line is a boolean FlowField; the text lives in comment lines.
        FaultComment := ApiHelper.GetServiceOrderComments(Rec."Document No.", Rec."Line No.", ServiceCommentLine.Type::Fault);
    end;
}
