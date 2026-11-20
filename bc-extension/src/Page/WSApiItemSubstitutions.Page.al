/// <summary>
/// Substitute items (Item Substitution, item → item) – read only. Shown in the item lookup of the Monteur-App.
/// </summary>
page 50121 "WS API Item Substitutions"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'itemSubstitution';
    EntitySetName = 'itemSubstitutions';
    EntityCaption = 'Item Substitution';
    EntitySetCaption = 'Item Substitutions';
    SourceTable = "Item Substitution";
    SourceTableView = where(Type = const(Item), "Substitute Type" = const(Item));
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { }
                field(itemNumber; Rec."No.") { }
                field(substituteNumber; Rec."Substitute No.") { }
                field(interchangeable; Rec.Interchangeable) { }
                field(description; Rec.Description) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
